import { normalizeInteraction, normalizeReadback } from './model.js'

const value = (source, ...keys) => {
  for (const key of keys) {
    if (source?.[key] !== undefined && source?.[key] !== null) return source[key]
  }
  return undefined
}

export async function runAcceptanceFlow({
  accountId,
  canonicalMessageId,
  createSession,
  persist,
  consume,
  readback,
  onPhase = () => {},
}) {
  onPhase('creatingInteraction')
  const sessionPayload = await createSession(accountId)
  const session = normalizeInteraction(sessionPayload)
  const challenge = value(sessionPayload, 'challenge') || value(sessionPayload?.session, 'challenge')
  if (!challenge) throw new Error('The acceptance session did not return its one-time challenge.')

  onPhase('persisting')
  const persisted = await persist(session.interactionId, canonicalMessageId)
  const classificationId = value(persisted, 'classificationId', 'classification_id')
    || value(persisted?.classification, 'classificationId', 'classification_id', 'id')
  if (!classificationId) throw new Error('The server did not return a classification ID.')

  onPhase('consuming')
  const consumed = await consume(session.interactionId, { challenge, classificationId: String(classificationId) })
  if (String(value(consumed, 'status') || '').toUpperCase() !== 'CONSUMED') {
    throw new Error('The acceptance session was not consumed.')
  }
  const consumedClassificationId = value(consumed, 'classificationId', 'classification_id')
  if (consumedClassificationId && String(consumedClassificationId) !== String(classificationId)) {
    throw new Error('The consumed classification does not match the persisted record.')
  }

  onPhase('readingBack')
  const receipt = normalizeReadback(await readback(session.interactionId, canonicalMessageId), {
    acceptanceSessionId: session.interactionId,
    canonicalMessageId,
    consumedReceipt: consumed,
  })
  onPhase('verified')
  return receipt
}
