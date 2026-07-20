import {defineConfig, loadEnv} from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import {ElementPlusResolver} from 'unplugin-vue-components/resolvers'
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig(({mode}) => {
    const env = loadEnv(mode, process.cwd(), 'VITE')
    if (mode === 'release') {
        const requiredBuildIdentity = [
            'VITE_NEXORA_BUILD_ID',
            'VITE_NEXORA_BUILD_VERSION',
            'VITE_NEXORA_SOURCE_COMMIT',
            'VITE_NEXORA_BUILD_POLICY_VERSION',
        ]
        const missingBuildIdentity = requiredBuildIdentity.filter((key) => !String(env[key] || '').trim())
        if (missingBuildIdentity.length > 0) {
            throw new Error(`Release build identity is incomplete: ${missingBuildIdentity.join(', ')}`)
        }
        if (!/^[0-9a-f]{40}$/i.test(env.VITE_NEXORA_SOURCE_COMMIT)) {
            throw new Error('VITE_NEXORA_SOURCE_COMMIT must be a full 40-character Git commit')
        }
        if (env.VITE_NEXORA_BUILD_ID !== env.VITE_NEXORA_SOURCE_COMMIT) {
            throw new Error('Desktop build ID must equal the immutable reviewed source commit')
        }
    }
    return {
        server: {
            host: true,
            port: 3001,
            hmr: true,
        },
        base: env.VITE_STATIC_URL || '/',
        plugins: [vue(),
            VitePWA({
                injectRegister: 'script-defer',
                manifest: {
                    name: env.VITE_PWA_NAME,
                    short_name: env.VITE_PWA_NAME,
                    background_color: '#FFFFFF',
                    theme_color: '#FFFFFF',
                    icons: [
                        {
                            src: 'mail-pwa.png',
                            sizes: '192x192',
                            type: 'image/png',
                        }
                    ],
                },
                workbox: {
                    disableDevLogs: true,
                    globPatterns: [],
                    runtimeCaching: [],
                    navigateFallback: null,
                    cleanupOutdatedCaches: true,
                }
            }),
            AutoImport({
                resolvers: [ElementPlusResolver()],
            }),
            Components({
                resolvers: [ElementPlusResolver()],
            })
        ],
        resolve: {
            alias: {
                '@': path.resolve(__dirname, 'src')
            }
        },
        build: {
            target: 'es2022',
            outDir: env.VITE_OUT_DIR || 'dist',
            emptyOutDir: true,
            assetsInclude: ['**/*.json']
        }
    }
})
