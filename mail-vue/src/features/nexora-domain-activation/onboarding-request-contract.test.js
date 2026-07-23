import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import { buildReadOnlyGmailRequest, requireGoogleOAuthUrl } from './gmail-onboarding.js'

const source = [
  fs.readFileSync(new URL('../../request/nexora-onboarding.js', import.meta.url), 'utf8'),
  fs.readFileSync(new URL('./gmail-onboarding.js', import.meta.url), 'utf8'),
].join('\n')

test('Gmail onboarding launch is authenticated, canonical, and read-only', () => {
  assert.match(source, /\/v3\/onboarding\/start/)
  assert.match(source, /provider:\s*['"]google['"]/)
  assert.match(source, /capabilities:\s*\[['"]mail_read['"]\]/)
  assert.match(source, /account_id:\s*account/)
  assert.match(source, /authority_generation:\s*0/)

  for (const forbidden of ['mail_send', 'gmail.send', 'draft', 'delete', 'watch', 'get_delta']) {
    assert.equal(source.includes(forbidden), false, `forbidden OAuth capability entered request: ${forbidden}`)
  }
})

test('owner generation zero and one stable retry key are executable request values', () => {
  const request = buildReadOnlyGmailRequest({ workspaceId: 1, accountId: 7, idempotencyKey: 'stable-attempt' })
  assert.deepEqual(request, {
    workspace: 1,
    body: {
      workspace_id: 1,
      provider: 'google',
      capabilities: ['mail_read'],
      idempotency_key: 'stable-attempt',
      account_id: 7,
      authority_generation: 0,
    },
  })
})

test('only the exact HTTPS Google Accounts host is accepted', () => {
  assert.equal(
    requireGoogleOAuthUrl('https://accounts.google.com/o/oauth2/v2/auth?state=opaque'),
    'https://accounts.google.com/o/oauth2/v2/auth?state=opaque',
  )
  for (const unsafe of [
    'http://accounts.google.com/o/oauth2/v2/auth',
    'https://accounts.google.com.evil.example/o/oauth2/v2/auth',
    'https://example.com/',
  ]) assert.throws(() => requireGoogleOAuthUrl(unsafe), /destination was rejected/)
})
