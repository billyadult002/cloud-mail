import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import {
  acceptanceStatus,
  normalizeInteraction,
  normalizeReadback,
  shortReference,
} from './model.js'

const workerReadback = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/worker-readback.json', import.meta.url)), 'utf8'))
const readbackContext = {
  acceptanceSessionId: 'session-1',
  canonicalMessageId: 42,
  consumedReceipt: {
    status: 'CONSUMED',
    classificationId: 'classification-1',
    classificationEvidenceRef: 'evidence-2',
  },
}

test('acceptanceStatus exposes accessible status semantics for every phase', () => {
  assert.deepEqual(acceptanceStatus('idle'), {
    kind: 'status',
    busy: false,
    title: 'Server verification available',
    detail: 'Verify this message classification against NEXORA production evidence.',
  })
  assert.equal(acceptanceStatus('creatingInteraction').busy, true)
  assert.equal(acceptanceStatus('persisting').busy, true)
  assert.equal(acceptanceStatus('readingBack').busy, true)
  assert.equal(acceptanceStatus('verified').kind, 'success')
  assert.equal(acceptanceStatus('blocked').kind, 'warning')
  assert.equal(acceptanceStatus('blockedUnauthorized').kind, 'warning')
  assert.equal(acceptanceStatus('blockedConfiguration').kind, 'warning')
  assert.equal(acceptanceStatus('blockedConfiguration').busy, false)
  assert.equal(acceptanceStatus('failed').kind, 'error')
})

test('normalizeInteraction accepts camel- and snake-case server receipts', () => {
  assert.deepEqual(normalizeInteraction({ interaction_id: 'runtime-123', started_at: '2026-07-19T12:00:00Z' }), {
    interactionId: 'runtime-123',
    startedAt: '2026-07-19T12:00:00Z',
  })
  assert.deepEqual(normalizeInteraction({ interactionId: 'runtime-456', startedAt: '2026-07-19T12:01:00Z' }), {
    interactionId: 'runtime-456',
    startedAt: '2026-07-19T12:01:00Z',
  })
  assert.deepEqual(normalizeInteraction({ acceptanceSessionId: 'session-789', issuedAt: '2026-07-19T12:02:00Z' }), {
    interactionId: 'session-789',
    startedAt: '2026-07-19T12:02:00Z',
  })
  assert.throws(() => normalizeInteraction({}), /interaction ID/i)
})

test('normalizeReadback accepts the real Worker shape and returns only bodyless fields', () => {
  const receipt = normalizeReadback({
    ...workerReadback,
    subject: 'must not escape',
    body: 'must not escape',
    token: 'must not escape',
  }, readbackContext)

  assert.deepEqual(receipt, {
    interactionId: 'session-1',
    classificationId: 'classification-1',
    evidenceId: 'evidence-2',
    evidenceRef: 'entry-digest-2',
    category: 'BUSINESS',
    confidence: 91,
    persistedAt: '2026-07-19T12:02:00Z',
    accountId: 9,
  })
  assert.equal('subject' in receipt, false)
  assert.equal('body' in receipt, false)
  assert.equal('token' in receipt, false)
})

test('normalizeReadback rejects incomplete, stale, or non-bodyless Worker receipts', () => {
  assert.throws(() => normalizeReadback({}, readbackContext), /complete classification evidence/i)
  assert.throws(() => normalizeReadback(workerReadback, {
    ...readbackContext,
    consumedReceipt: { ...readbackContext.consumedReceipt, classificationEvidenceRef: 'evidence-missing' },
  }), /consumed evidence/i)
  assert.throws(() => normalizeReadback({
    ...workerReadback,
    provenance: { ...workerReadback.provenance, bodyPersisted: true },
  }, readbackContext), /bodyless canonical provenance/i)
})

test('shortReference is stable and does not expose full identifiers', () => {
  assert.equal(shortReference('classification-1234567890'), 'classifi…7890')
  assert.equal(shortReference('short'), 'short')
  assert.equal(shortReference(''), '—')
})

test('status card source keeps the acceptance flow keyboard and screen-reader observable', () => {
  const source = readFileSync(fileURLToPath(new URL('./ClassificationEvidenceCard.vue', import.meta.url)), 'utf8')
  const messageDetail = readFileSync(fileURLToPath(new URL('../../views/content/index.vue', import.meta.url)), 'utf8')
  assert.match(source, /aria-live="polite"/)
  assert.match(source, /:aria-busy="status\.busy"/)
  assert.match(source, /role="alert"/)
  assert.match(source, /@media \(prefers-reduced-motion: reduce\)/)
  assert.match(source, /@media \(prefers-contrast: more\)/)
  assert.match(source, /desktopAcceptanceConfigured\(\)/)
  assert.match(source, /isUnauthorized\(error\).*blockedUnauthorized/s)
  assert.match(messageDetail, /v-if="isAdmin && email\.emailId/)
  assert.match(messageDetail, /permKeys\.includes\('\*'\)/)
})

test('API client uses only the approved acceptance contract', () => {
  const source = readFileSync(fileURLToPath(new URL('../../request/nexora-classification.js', import.meta.url)), 'utf8')
  assert.match(source, /\/v3\/acceptance\/sessions/)
  assert.match(source, /\/v3\/classification\/persist/)
  assert.match(source, /\/v3\/classification\/records\//)
  assert.match(source, /\/consume`/)
  assert.match(source, /\{\s*challenge,\s*classificationId,?\s*\}/s)
  assert.doesNotMatch(source, /tenantId|workspaceId|provider|domain|subject|body|sender/)
})
