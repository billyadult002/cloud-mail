<template>
  <section
    ref="card"
    class="evidence-card"
    :class="`evidence-card--${status.kind}`"
    :aria-busy="status.busy"
    aria-labelledby="classification-evidence-title"
    tabindex="-1"
  >
    <div class="evidence-card__heading">
      <div>
        <p class="evidence-card__eyebrow">NEXORA Evidence</p>
        <h2 id="classification-evidence-title">Verified classification</h2>
      </div>
      <span class="evidence-card__badge" aria-hidden="true">{{ badge }}</span>
    </div>

    <div aria-live="polite" aria-atomic="true">
      <p class="evidence-card__status" role="status">{{ status.title }}</p>
      <p class="evidence-card__detail">{{ status.detail }}</p>
    </div>

    <p v-if="failure" class="evidence-card__error" role="alert">{{ failure }}</p>

    <dl v-if="receipt" class="evidence-card__receipt" aria-label="Server evidence receipt">
      <div><dt>Category</dt><dd>{{ receipt.category }}</dd></div>
      <div><dt>Confidence</dt><dd>{{ receipt.confidence }}%</dd></div>
      <div><dt>Classification</dt><dd>{{ shortReference(receipt.classificationId) }}</dd></div>
      <div><dt>Evidence</dt><dd>{{ shortReference(receipt.evidenceId) }}</dd></div>
      <div><dt>Acceptance session</dt><dd>{{ shortReference(receipt.interactionId) }}</dd></div>
      <div><dt>Persisted</dt><dd>{{ formattedTimestamp }}</dd></div>
    </dl>

    <el-button
      class="evidence-card__action"
      type="primary"
      :loading="status.busy"
      :disabled="status.busy || !canVerify"
      @click="verify"
    >
      {{ receipt ? 'Verify again' : 'Verify server evidence' }}
    </el-button>
    <p v-if="!targetAvailable" class="evidence-card__hint">A canonical account and message are required.</p>
    <p v-else-if="!buildConfigured" class="evidence-card__hint">This deployment is missing its approved desktop build identity.</p>
  </section>
</template>

<script setup>
import { computed, nextTick, ref } from 'vue'
import {
  createDesktopInteraction,
  consumeDesktopAcceptance,
  desktopAcceptanceConfigured,
  persistServerClassification,
  readServerClassification,
} from '@/request/nexora-classification.js'
import {
  acceptanceStatus,
  errorMessage,
  isAuthorityBlock,
  isUnauthorized,
  shortReference,
} from './model.js'
import { runAcceptanceFlow } from './flow.js'

const props = defineProps({
  accountId: { type: [Number, String], required: true },
  canonicalMessageId: { type: [Number, String], required: true },
})

const buildConfigured = desktopAcceptanceConfigured()
const phase = ref(buildConfigured ? 'idle' : 'blockedConfiguration')
const receipt = ref(null)
const failure = ref('')
const card = ref(null)

const status = computed(() => acceptanceStatus(phase.value))
const targetAvailable = computed(() => Number(props.accountId) > 0 && String(props.canonicalMessageId || '').length > 0)
const canVerify = computed(() => buildConfigured && targetAvailable.value)
const badge = computed(() => ({
  success: 'Verified',
  warning: 'Blocked',
  error: 'Failed',
  status: status.value.busy ? 'Working' : 'Ready',
})[status.value.kind])
const formattedTimestamp = computed(() => {
  if (!receipt.value?.persistedAt) return '—'
  const date = new Date(receipt.value.persistedAt)
  return Number.isNaN(date.getTime()) ? receipt.value.persistedAt : date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'medium' })
})

async function announceTerminalState() {
  await nextTick()
  card.value?.focus({ preventScroll: true })
}

async function verify() {
  if (!canVerify.value || status.value.busy) return
  failure.value = ''
  receipt.value = null
  try {
    receipt.value = await runAcceptanceFlow({
      accountId: props.accountId,
      canonicalMessageId: props.canonicalMessageId,
      createSession: createDesktopInteraction,
      persist: persistServerClassification,
      consume: consumeDesktopAcceptance,
      readback: readServerClassification,
      onPhase: nextPhase => { phase.value = nextPhase },
    })
  } catch (error) {
    failure.value = errorMessage(error)
    phase.value = isUnauthorized(error) ? 'blockedUnauthorized' : isAuthorityBlock(error) ? 'blocked' : 'failed'
  }
  await announceTerminalState()
}
</script>

<style scoped>
.evidence-card {
  max-width: 48rem;
  margin: 0 0 1.25rem;
  padding: 1rem;
  border: 1px solid color-mix(in srgb, var(--light-border-color) 80%, transparent);
  border-radius: 0.875rem;
  background: color-mix(in srgb, var(--light-ill) 88%, transparent);
  box-shadow: 0 0.5rem 1.5rem rgb(0 0 0 / 8%);
  backdrop-filter: blur(1rem) saturate(140%);
  transition: border-color 180ms ease, background-color 180ms ease, box-shadow 180ms ease;
}

.evidence-card:focus-visible {
  outline: 0.1875rem solid var(--el-color-primary);
  outline-offset: 0.1875rem;
}

.evidence-card--success { border-color: color-mix(in srgb, var(--el-color-success) 55%, transparent); }
.evidence-card--warning { border-color: color-mix(in srgb, var(--el-color-warning) 65%, transparent); }
.evidence-card--error { border-color: color-mix(in srgb, var(--el-color-danger) 60%, transparent); }

.evidence-card__heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}

.evidence-card__heading h2 {
  margin: 0;
  font: 650 1.125rem/1.2 system-ui, sans-serif;
  letter-spacing: -0.01em;
}

.evidence-card__eyebrow {
  margin: 0 0 0.2rem;
  color: var(--secondary-text-color);
  font: 650 0.75rem/1.3 system-ui, sans-serif;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.evidence-card__badge {
  flex: none;
  padding: 0.3rem 0.6rem;
  border-radius: 999px;
  background: var(--light-ill);
  font-weight: 650;
}

.evidence-card__status { margin: 0.8rem 0 0.2rem; font-weight: 650; }
.evidence-card__detail, .evidence-card__hint { margin: 0; color: var(--regular-text-color); line-height: 1.5; }
.evidence-card__error { color: var(--el-color-danger); font-weight: 650; line-height: 1.5; }

.evidence-card__receipt {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
  gap: 0.75rem;
  margin: 1rem 0;
}

.evidence-card__receipt div { min-width: 0; }
.evidence-card__receipt dt { color: var(--secondary-text-color); font-size: 0.75rem; }
.evidence-card__receipt dd { margin: 0.15rem 0 0; overflow-wrap: anywhere; font-weight: 650; }
.evidence-card__action { min-height: 2.75rem; margin-top: 1rem; }
.evidence-card__hint { margin-top: 0.5rem; }

@media (prefers-reduced-motion: reduce) {
  .evidence-card { transition: none; }
}

@media (prefers-reduced-transparency: reduce) {
  .evidence-card { background: var(--light-ill); backdrop-filter: none; }
}

@media (prefers-contrast: more) {
  .evidence-card { border-width: 0.125rem; box-shadow: none; }
}
</style>
