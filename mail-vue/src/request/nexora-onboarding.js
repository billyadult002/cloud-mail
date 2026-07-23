import http from '@/axios/index.js'
import { buildReadOnlyGmailRequest } from '@/features/nexora-domain-activation/gmail-onboarding.js'

export function startReadOnlyGmailOnboarding({ workspaceId, accountId, idempotencyKey }) {
  const request = buildReadOnlyGmailRequest({ workspaceId, accountId, idempotencyKey })
  return http.post(`/v3/onboarding/start?workspace_id=${request.workspace}`, request.body, { noMsg: true })
}
