# Connection Capability Coverage Report

| Capability | Contract | Local proof | Production proof |
|---|---:|---:|---:|
| Discover exact Gmail connection | implemented | canonical account login-hash binding + negative SQL review | not run |
| Bind OAuth authorization/callback | implemented | callback regressions pass | not run |
| Resolve opaque credential reference | implemented | negative contract proof | not run |
| Create non-serializable Provider Session | implemented | real D1 operation/lease test | not run |
| Bounded Gmail health GET | implemented | fixture proof | not run |
| Refresh/rotate with fence | implemented | refresh regressions pass | not run |
| Backoff/jitter/attempt cap | implemented | source/fixture proof | not run |
| Evidence and canonical independent Verification | implemented | canonical verifier + migration rejection probe | not run |
| Suspend/revoke | contract/schema only | negative transitions | not run |
| Gmail watch/get_delta/sync | prohibited | absent | not claimed |
| Send/draft/write | prohibited | absent | not claimed |
| Microsoft live provider | out of scope | no | not claimed |
