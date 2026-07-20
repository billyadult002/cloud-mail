import http from '@/axios/index.js'

export function desktopAcceptanceConfigured() {
  return Boolean(
    import.meta.env.VITE_NEXORA_BUILD_ID &&
    import.meta.env.VITE_NEXORA_BUILD_VERSION &&
    import.meta.env.VITE_NEXORA_SOURCE_COMMIT &&
    import.meta.env.VITE_NEXORA_BUILD_POLICY_VERSION &&
    import.meta.env.VITE_NEXORA_BUILD_ID === import.meta.env.VITE_NEXORA_SOURCE_COMMIT
  )
}

export function createDesktopInteraction(accountId) {
  if (!desktopAcceptanceConfigured()) throw new Error('Desktop acceptance build identity is not configured.')
  return http.post('/v3/acceptance/sessions', {
    accountId: Number(accountId),
    platform: 'DESKTOP',
    buildId: import.meta.env.VITE_NEXORA_BUILD_ID,
    buildVersion: import.meta.env.VITE_NEXORA_BUILD_VERSION,
    sourceCommit: import.meta.env.VITE_NEXORA_SOURCE_COMMIT,
    buildPolicyVersion: import.meta.env.VITE_NEXORA_BUILD_POLICY_VERSION,
  })
}

export function persistServerClassification(acceptanceSessionId, canonicalMessageId) {
  return http.post('/v3/classification/persist', {
    acceptanceSessionId,
    canonicalMessageId,
  })
}

export function consumeDesktopAcceptance(acceptanceSessionId, { challenge, classificationId }) {
  return http.post(`/v3/acceptance/sessions/${encodeURIComponent(acceptanceSessionId)}/consume`, {
    challenge,
    classificationId,
  })
}

export function readServerClassification(acceptanceSessionId, canonicalMessageId) {
  return http.get(`/v3/classification/records/${encodeURIComponent(canonicalMessageId)}`, {
    params: { acceptanceSessionId },
    cache: false,
  })
}
