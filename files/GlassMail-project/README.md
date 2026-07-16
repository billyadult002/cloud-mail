# CloudMail

自托管邮箱的原生 iOS / macOS 客户端，采用 iOS 26 / macOS 26 的 **Liquid Glass** 设计语言，内置 **AI 邮件管理**（自动摘要、自动分类、AI 起草回复）。后端连接你自己的 cloud-mail（Cloudflare Worker）。

- **域名 / 服务器**：首次打开 App 时填写，其余全自动。已预置 `fastonegroup.com` 与 `https://cloud-mail.fastonegroup.workers.dev`，可在设置里随时改。
- **AI 引擎**：三选一，可随时切换
  - **Apple 智能（设备端）**— 默认。免费、私密、离线、**无需登录、无需任何 key**。开箱即用。
  - **ChatGPT** —「Sign in with ChatGPT」登录（用你的 ChatGPT 账户，不是粘贴 API key）。
  - **Gemini** — 用你账户生成的 Google AI key 授权。

---

## 一、如何构建（唯一需要你动手的一步）

我无法在云端替你编译/签名一个原生 App —— 这一步必须在你的 Mac 上用 **Xcode 26** 完成。两种方式任选其一：

**方式 A（最简单）**：双击 `setup.command`，它会自动打开工程；若提示工程格式问题，按提示回车，它会用 XcodeGen 重新生成一个保证可用的工程并打开。

**方式 B（手动）**：直接双击 `GlassMail.xcodeproj` 打开。

打开后：
1. 顶部选择一个 **iPhone 模拟器**（例如 iPhone 16），按 **⌘R** 运行。模拟器无需任何签名配置。
2. 想装到**真机或 Mac**：点选左侧保留的 `GlassMail` 技术 target → **Signing & Capabilities** → 在 *Team* 里选你的 Apple ID（免费 Apple ID 即可）。Xcode 会自动处理签名。
3. App 启动后，输入你的域名、邮箱、密码登录即可。

> 需要 macOS 26 + Xcode 26。Apple 智能要求设备支持 Apple Intelligence 并已开启；不支持时 App 会自动提示并可改用 ChatGPT / Gemini。

---

## 二、关于「用登录、而不是 API key」的真实情况

你的要求是 AI 用**登录授权**而非 API key。这里如实说明每家的现状：

- **Apple 智能** ✅ 完全符合且最彻底：根本没有账户/key 的概念，全在设备上完成。这就是默认引擎，零配置即可用。

- **ChatGPT** ✅ 符合：OpenAI 提供官方的「Sign in with ChatGPT」(OAuth + PKCE)。用户登录自己的 ChatGPT 账户，用量走你的套餐额度，App 拿到的是登录令牌而非粘贴的 key。
  - ⚠️ **一次性前置**（无法由 App 自动完成）：OpenAI 要求开发者先在 platform.openai.com 注册应用拿到一个 `clientID`，并登记回调地址 `glassmail://oauth-callback`。把 `clientID` 填到 `GlassMail/AI/OpenAIProvider.swift` 里的 `OpenAIAuth.clientID`。在你填好之前，ChatGPT 登录按钮不可用，App 会自动改用 Apple 设备端模型 —— 所以功能始终可用。

- **Gemini** ⚠️ 需如实告知：Google **没有**让第三方 App 用「消费者版 Gemini 订阅 + 登录」直接调用的合规方式。最接近的那种 token 代理方式已在 **2026 年 2 月被 Google 封禁，并导致账户（含付费 Ultra）被封**。因此本项目**刻意不实现**那条会害你账户被封的路径。可行且账户安全的方式是：在 Google AI Studio 用你自己的账户生成一个 AI key，在设置里授权填入。或者直接用 Apple 设备端模型。

> 行业动态：WWDC26 上 Apple 的 Foundation Models 已开放给任意大模型接入（`LanguageModel` 协议），Anthropic / Google 官方的 Claude / Gemini Swift 包据称「即将」上线。等正式包发布后，可把 Gemini 换成官方登录式接入，无需 key。

---

## 三、工程结构

`GlassMail-project`、`GlassMail.xcodeproj`、`GlassMail/` 和 `glassmail://` 为升级、签名及深链兼容而保留；用户可见产品名和产物名均为 CloudMail。

```
GlassMail-project/
├── GlassMail.xcodeproj         # 预生成的 Xcode 工程（同步文件夹格式）
├── project.yml                 # XcodeGen 配置（方式 A 的兜底）
├── setup.command               # 双击即可打开/重建工程
└── GlassMail/
    ├── GlassMailApp.swift       # App 入口（iOS WindowGroup + macOS Settings 场景）
    ├── Models/Models.swift      # 对接 cloud-mail 的 Codable 模型
    ├── Services/
    │   ├── Backend.swift        # cloud-mail API（原始 token 鉴权、分页、发信）
    │   ├── AppState.swift       # 全局状态（配置、会话、邮件、AI 路由）
    │   └── Keychain.swift       # 令牌 / 凭据安全存储
    ├── AI/
    │   ├── AIProvider.swift          # 可插拔 AI 协议 + 路由（云端不可用自动回退 Apple）
    │   ├── AppleFoundationProvider.swift  # 设备端 Foundation Models（@Generable 引导生成）
    │   ├── OpenAIProvider.swift      # ChatGPT（Sign in with ChatGPT）
    │   └── GeminiProvider.swift      # Gemini（账户 AI key 授权）
    ├── Views/
    │   ├── RootView.swift            # 登录态切换
    │   ├── OnboardingView.swift      # 唯一的输入页：域名 + 邮箱 + 密码
    │   ├── InboxView.swift           # 收件箱（Liquid Glass 列表、搜索、滑动 AI/删除、后台自动摘要）
    │   ├── EmailDetailView.swift     # 详情 + AI 操作 + 回复
    │   ├── SettingsView.swift        # 引擎选择 / ChatGPT 登录 / Gemini key / 服务器
    │   └── Components.swift          # GlassCard 等共享组件
    └── Assets.xcassets              # 应用图标 + 主题色
```

---

## 四、后端要点（cloud-mail）

App 默认连接 `https://cloud-mail.fastonegroup.workers.dev`，所有接口在 `{server}/api/...`，鉴权头是**原始 token**（非 `Bearer`）。要让收件箱收到信，请确认 Cloudflare Email Routing 的 **Catch-all 指向 Worker**，且没有更高优先级的「转发到外部邮箱」自定义规则把邮件提前截走。

---

CloudMail · Liquid Glass · iOS / macOS 26
