const STATUS = Object.freeze({
  idle: {
    kind: 'status',
    busy: false,
    title: 'Server verification available',
    detail: 'Verify this message classification against NEXORA production evidence.',
  },
  creatingInteraction: {
    kind: 'status',
    busy: true,
    title: 'Establishing secure session',
    detail: 'NEXORA is binding this desktop interaction to your authenticated account.',
  },
  persisting: {
    kind: 'status',
    busy: true,
    title: 'Classifying on the server',
    detail: 'The verified Domain Authority chain is being checked before evidence is persisted.',
  },
  consuming: {
    kind: 'status',
    busy: true,
    title: 'Binding acceptance evidence',
    detail: 'NEXORA is atomically correlating this classification with the one-time desktop session.',
  },
  readingBack: {
    kind: 'status',
    busy: true,
    title: 'Verifying persisted evidence',
    detail: 'NEXORA is reading the classification back from the authoritative server record.',
  },
  verified: {
    kind: 'success',
    busy: false,
    title: 'Server evidence verified',
    detail: 'Classification and bodyless Evidence were persisted and read back successfully.',
  },
  blocked: {
    kind: 'warning',
    busy: false,
    title: 'Server verification unavailable',
    detail: 'This account does not currently have the verified authority required for this operation.',
  },
  blockedUnauthorized: {
    kind: 'warning',
    busy: false,
    title: 'Administrator authority required',
    detail: 'Only an authenticated NEXORA administrator can persist verified production classifications.',
  },
  blockedConfiguration: {
    kind: 'warning',
    busy: false,
    title: 'Desktop verification is not configured',
    detail: 'This build has no approved acceptance identity. Ask an administrator to deploy an allowlisted desktop build.',
  },
  failed: {
    kind: 'error',
    busy: false,
    title: 'Server verification failed',
    detail: 'No verified acceptance claim was created. Review the error and try again.',
  },
})

const first = (source, ...keys) => {
  for (const key of keys) {
    if (source?.[key] !== undefined && source?.[key] !== null) return source[key]
  }
  return undefined
}

export function acceptanceStatus(phase) {
  return STATUS[phase] || STATUS.failed
}

export function normalizeInteraction(payload = {}) {
  const source = payload.interaction || payload
  const interactionId = first(source, 'acceptanceSessionId', 'acceptance_session_id', 'sessionId', 'session_id', 'interactionId', 'interaction_id', 'id')
  if (!interactionId) throw new Error('The server did not return an interaction ID.')
  return {
    interactionId: String(interactionId),
    startedAt: first(source, 'startedAt', 'started_at', 'issuedAt', 'issued_at', 'createdAt', 'created_at') || null,
  }
}

export function normalizeReadback(payload = {}, context = {}) {
  const classification = payload.classification || {}
  const provenance = payload.provenance || {}
  const evidenceChain = Array.isArray(payload.evidence) ? payload.evidence : []
  const consumed = context.consumedReceipt || {}
  const interactionId = context.acceptanceSessionId
  const classificationId = first(classification, 'id', 'classificationId', 'classification_id')
  const consumedClassificationId = first(consumed, 'classificationId', 'classification_id')
  const consumedEvidenceRef = first(consumed, 'classificationEvidenceRef', 'classification_evidence_ref')

  if (!interactionId || !classificationId || !consumedClassificationId || !consumedEvidenceRef) {
    throw new Error('The server did not return complete classification evidence.')
  }
  if (String(first(consumed, 'status') || '').toUpperCase() !== 'CONSUMED') {
    throw new Error('The acceptance session is not currently consumed.')
  }
  if (String(classificationId) !== String(consumedClassificationId)) {
    throw new Error('The readback classification does not match the consumed receipt.')
  }
  const currentEvidence = evidenceChain.find(row => String(first(row, 'evidenceId', 'evidence_id', 'id')) === String(consumedEvidenceRef))
  if (!currentEvidence) {
    throw new Error('The readback does not contain the consumed evidence record.')
  }
  const evidenceRef = first(classification, 'evidenceRef', 'evidence_ref')
  const entryDigest = first(currentEvidence, 'entryDigest', 'entry_digest')
  if (!evidenceRef || String(evidenceRef) !== String(entryDigest)) {
    throw new Error('The current classification and Evidence ledger head do not match.')
  }
  if (provenance.source !== 'CANONICAL_EMAIL' || provenance.bodyPersisted !== false
    || currentEvidence.bodyPersisted !== false || String(first(currentEvidence, 'redactionLevel', 'redaction_level')).toUpperCase() !== 'BODYLESS') {
    throw new Error('The readback is not bodyless canonical provenance.')
  }
  if (String(first(provenance, 'canonicalMessageId', 'canonical_message_id')) !== String(context.canonicalMessageId)) {
    throw new Error('The readback canonical message does not match the requested record.')
  }

  return {
    interactionId: String(interactionId),
    classificationId: String(classificationId),
    evidenceId: String(first(currentEvidence, 'evidenceId', 'evidence_id', 'id')),
    evidenceRef: String(evidenceRef),
    category: first(classification, 'primaryCategory', 'primary_category', 'category') || 'UNCLASSIFIED',
    confidence: Number(first(classification, 'confidence') || 0),
    persistedAt: first(classification, 'classifiedAt', 'classified_at', 'updatedAt', 'updated_at') || first(currentEvidence, 'observedAt', 'observed_at') || null,
    accountId: first(provenance, 'canonicalAccountId', 'canonical_account_id') ?? null,
  }
}

export function shortReference(value) {
  const text = String(value || '')
  if (!text) return '—'
  if (text.length <= 12) return text
  return `${text.slice(0, 8)}…${text.slice(-4)}`
}

export function errorMessage(error) {
  return error?.message || error?.response?.data?.message || error?.data?.message || 'The server could not verify this classification.'
}

export function isAuthorityBlock(error) {
  const status = Number(error?.status || error?.response?.status || error?.code || error?.response?.data?.code)
  const message = errorMessage(error).toLowerCase()
  return status === 401 || status === 403 || message.includes('authority') || message.includes('workspace') || message.includes('domain')
}

export function isUnauthorized(error) {
  const status = Number(error?.status || error?.response?.status || error?.code || error?.response?.data?.code)
  const message = errorMessage(error).toLowerCase()
  return status === 401 || status === 403 || message.includes('admin classification authority')
}
