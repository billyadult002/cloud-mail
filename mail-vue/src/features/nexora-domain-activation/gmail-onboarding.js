const positiveInteger = (value, label) => {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number <= 0) throw new Error(`${label} is required.`)
  return number
}

export function buildReadOnlyGmailRequest({ workspaceId, accountId, idempotencyKey }) {
  const workspace = positiveInteger(workspaceId, 'Workspace')
  const account = positiveInteger(accountId, 'Account')
  if (!idempotencyKey) throw new Error('An idempotency key is required.')
  return {
    workspace,
    body: {
      workspace_id: workspace,
      provider: 'google',
      capabilities: ['mail_read'],
      idempotency_key: String(idempotencyKey),
      account_id: account,
      authority_generation: 0,
    },
  }
}

export function requireGoogleOAuthUrl(value) {
  const url = new URL(value)
  if (url.protocol !== 'https:' || url.hostname !== 'accounts.google.com') {
    throw new Error('The Google authorization destination was rejected.')
  }
  return url.toString()
}
