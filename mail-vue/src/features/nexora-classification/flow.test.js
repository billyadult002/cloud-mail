import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { runAcceptanceFlow } from './flow.js'

const target = { accountId: 7, canonicalMessageId: 42 }
const workerReadback = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/worker-readback.json', import.meta.url)), 'utf8'))

test('acceptance flow consumes the in-memory challenge before readback', async () => {
  const calls = []
  const receipt = await runAcceptanceFlow({
    ...target,
    createSession: async () => ({ id: 'session-1', challenge: 'memory-only-secret' }),
    persist: async (sessionId, messageId) => {
      calls.push(['persist', sessionId, messageId])
      return { classificationId: 'classification-1' }
    },
    consume: async (sessionId, body) => {
      calls.push(['consume', sessionId, body])
      return { status: 'CONSUMED', classificationId: 'classification-1', classificationEvidenceRef: 'evidence-2' }
    },
    readback: async (sessionId, messageId) => {
      calls.push(['readback', sessionId, messageId])
      return workerReadback
    },
  })

  assert.equal(receipt.classificationId, 'classification-1')
  assert.deepEqual(calls, [
    ['persist', 'session-1', 42],
    ['consume', 'session-1', { challenge: 'memory-only-secret', classificationId: 'classification-1' }],
    ['readback', 'session-1', 42],
  ])
  assert.equal(JSON.stringify(receipt).includes('memory-only-secret'), false)
})

test('a missing challenge cannot persist, consume, read back, or verify', async () => {
  let downstreamCalls = 0
  await assert.rejects(() => runAcceptanceFlow({
    ...target,
    createSession: async () => ({ id: 'session-1' }),
    persist: async () => { downstreamCalls += 1 },
    consume: async () => { downstreamCalls += 1 },
    readback: async () => { downstreamCalls += 1 },
  }), /challenge/i)
  assert.equal(downstreamCalls, 0)
})

test('consume failure prevents readback and verified state', async () => {
  let readbackCalls = 0
  const phases = []
  await assert.rejects(() => runAcceptanceFlow({
    ...target,
    createSession: async () => ({ id: 'session-1', challenge: 'secret' }),
    persist: async () => ({ classificationId: 'classification-1' }),
    consume: async () => { throw new Error('consume denied') },
    readback: async () => { readbackCalls += 1 },
    onPhase: phase => phases.push(phase),
  }), /consume denied/)
  assert.equal(readbackCalls, 0)
  assert.equal(phases.includes('verified'), false)
})

test('incomplete consume receipt cannot be treated as verified', async () => {
  let readbackCalls = 0
  await assert.rejects(() => runAcceptanceFlow({
    ...target,
    createSession: async () => ({ id: 'session-1', challenge: 'secret' }),
    persist: async () => ({ classificationId: 'classification-1' }),
    consume: async () => ({ status: 'ISSUED' }),
    readback: async () => { readbackCalls += 1 },
  }), /not consumed/i)
  assert.equal(readbackCalls, 0)
})
