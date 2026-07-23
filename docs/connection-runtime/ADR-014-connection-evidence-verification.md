# ADR-014: Connection Evidence and Verification Model

Status: accepted.

Connection events, operations, Evidence, and Verification are distinct records. An operation records exact authority/generation/lease/fence inputs and redacted response classification. Evidence records the operation identifier, classification, and safety flags. Connection Runtime never inserts Verification rows: it invokes the canonical Durable Mission Runtime verifier against an operation-specific claim and fail-closed policy. An immutable event predeclares the exact state edge.

D1 permits a transition only when the scoped operation is `VERIFIED`, Evidence is `supported` and names that exact operation, Verification is `verified` with valid integrity by `canonical_connection_policy_v1`, claim identity is `connection-claim:<operation>`, all generations match, and the current lease/fence remains active. The final operation/event/Connection/lease-release mutations are one guarded D1 batch. Evidence alone cannot create `HEALTHY`. Event updates and deletes are rejected. Tokens, authorization codes, mailbox content, and message metadata are forbidden.
