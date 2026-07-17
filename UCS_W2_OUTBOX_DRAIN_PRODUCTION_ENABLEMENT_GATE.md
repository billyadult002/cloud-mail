# UCS W2 Outbox Drain Production Enablement Gate

Status: **HOLD**.

Production enablement is prohibited until a clean scoped commit and annotated
tag exist, a staging Worker version is deployed with isolated bindings, and the
full structured 2/10/15/20/25 sweep identifies a safe candidate. Production
must remain unchanged: no Worker deployment, no `UCS_OUTBOX_DRAIN_LIMIT` value,
no HWM change, no projection-read change, and no UCS evidence-epoch write.
