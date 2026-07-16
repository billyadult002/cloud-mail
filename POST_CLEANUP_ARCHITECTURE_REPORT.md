# Post-Cleanup Architecture Report

The current safe architecture is:

`SwiftUI AppState → NexoraAgentEngine/AIRouter → local Apple Intelligence or explicitly authorized provider`

`SwiftUI Backend client → authenticated Hono routes → scoped Worker services → D1/R2/KV`

Cleanup removed two definition-only Worker methods and one obsolete cache restore helper. Active OAuth, delivery, mailbox, and provider-truth paths remain because removing them would regress protected GPT58–GPT65 behavior. Full single-engine convergence and provider metadata removal remain migration work, not a safe blind deletion.
