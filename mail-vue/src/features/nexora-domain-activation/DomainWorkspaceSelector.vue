<template>
  <section class="activation-shell" aria-labelledby="activation-title">
    <header class="hero">
      <div class="eyebrow">NEXORA · ADMIN</div>
      <h1 id="activation-title">{{ $t('domainActivationTitle') }}</h1>
      <p>{{ $t('domainActivationIntro') }}</p>
    </header>

    <ol class="stage-list" aria-label="Domain activation stages">
      <li class="stage-card" :class="{ complete: actorVerified }">
        <div class="stage-index" aria-hidden="true">1</div>
        <div class="stage-content">
          <h2>{{ $t('domainActivationActorTitle') }}</h2>
          <p class="actor">{{ actorLabel }}</p>
          <p class="support">{{ actorVerified ? $t('domainActivationActorVerified') : $t('domainActivationActorPending') }}</p>
          <el-button type="primary" :loading="discovering" @click="$emit('discover')">
            {{ $t('domainActivationDiscover') }}
          </el-button>
        </div>
      </li>

      <li class="stage-card" :class="{ active: actorVerified, complete: validated }">
        <div class="stage-index" aria-hidden="true">2</div>
        <fieldset class="stage-content" :disabled="!actorVerified || validating || validated">
          <legend>{{ $t('domainActivationWorkspaceTitle') }}</legend>
          <p class="support">{{ $t('domainActivationWorkspaceHelp') }}</p>
          <div v-if="actorVerified && workspaces.length === 0" class="empty" role="status">
            {{ $t('domainActivationNoWorkspace') }}
          </div>
          <label v-for="workspace in workspaces" :key="workspace.workspaceId" class="workspace-option"
                 :class="{ eligible: isEligible(workspace), selected: selectedWorkspaceId === workspace.workspaceId }">
            <input v-model.number="selectedWorkspaceId" type="radio" name="domain-workspace"
                   :value="workspace.workspaceId" :disabled="workspace.workspaceId !== 1 || !isEligible(workspace)" />
            <span class="workspace-copy">
              <strong>{{ workspace.displayName }}</strong>
              <small>Workspace ID {{ workspace.workspaceId }}</small>
              <small>{{ workspace.role || $t('domainActivationUnknownRole') }} · {{ capabilityLabel(workspace) }}</small>
            </span>
            <span class="status-pill">{{ isEligible(workspace) ? $t('domainActivationEligible') : $t('domainActivationReadOnly') }}</span>
          </label>
          <label v-if="workspaceOne" class="confirmation">
            <input v-model="confirmed" type="checkbox" />
            <span>{{ $t('domainActivationConfirmWorkspaceOne') }}</span>
          </label>
          <el-button type="primary" :loading="validating" :disabled="!canValidate" @click="requestValidation">
            {{ validated ? $t('domainActivationValidated') : $t('domainActivationValidate') }}
          </el-button>
        </fieldset>
      </li>

      <li class="stage-card" :class="{ active: validated, complete: verification }" :aria-disabled="!validated">
        <div class="stage-index" aria-hidden="true">3</div>
        <div class="stage-content">
          <h2>{{ $t('domainActivationDnsTitle') }}</h2>
          <p class="support">{{ challenge ? $t('domainActivationDnsPending') : $t('domainActivationDnsLocked') }}</p>
          <label v-if="validated && !challenge" class="confirmation">
            <input v-model="challengeApproved" type="checkbox" />
            <span>{{ $t('domainActivationConfirmChallenge') }}</span>
          </label>
          <el-button v-if="!challenge" :disabled="!validated || !challengeApproved" :loading="operation === 'creating'"
                     @click="$emit('create-challenge', { approved: challengeApproved })">
            {{ $t('domainActivationCreateChallenge') }}
          </el-button>
          <div v-else class="challenge" role="status" aria-live="polite">
            <strong>{{ challenge.name }}</strong>
            <code>{{ challenge.value }}</code>
            <small>{{ $t('domainActivationSensitiveTxt') }}</small>
            <label v-if="!verification" class="confirmation">
              <input v-model="verifyApproved" type="checkbox" />
              <span>{{ $t('domainActivationConfirmVerify') }}</span>
            </label>
            <p v-if="!validated && !verification" class="support">{{ $t('domainActivationRevalidateChallenge') }}</p>
            <el-button v-if="!verification" type="primary" :disabled="!validated || !verifyApproved" :loading="operation === 'verifying'"
                       @click="$emit('verify-challenge', { approved: verifyApproved })">
              {{ $t('domainActivationVerify') }}
            </el-button>
          </div>
        </div>
      </li>

      <li class="stage-card" :class="{ active: verification, complete: authority }" :aria-disabled="!verification">
        <div class="stage-index" aria-hidden="true">4</div>
        <div class="stage-content">
          <h2>{{ $t('domainActivationAuthorityTitle') }}</h2>
          <p class="support">{{ verification ? $t('domainActivationAuthorityReady') : $t('domainActivationAuthorityLocked') }}</p>
          <label v-if="verification && !authority" class="confirmation">
            <input v-model="bootstrapApproved" type="checkbox" />
            <span>{{ $t('domainActivationConfirmBootstrap') }}</span>
          </label>
          <el-button :disabled="!verification || !bootstrapApproved || Boolean(authority)" :loading="operation === 'bootstrapping'"
                     @click="$emit('bootstrap-authority', { approved: bootstrapApproved })">
            {{ authority ? $t('domainActivationAuthorityComplete') : $t('domainActivationBootstrap') }}
          </el-button>
        </div>
      </li>
    </ol>

    <div v-if="validated && receipt" class="receipt" role="status" aria-live="polite">
      <strong>{{ $t('domainActivationCapabilityValidated') }}</strong>
      <span>{{ $t('domainActivationNotStarted') }}</span>
      <dl>
        <div><dt>Workspace</dt><dd>1</dd></div>
        <div><dt>Request</dt><dd>{{ short(receipt.requestId) }}</dd></div>
        <div><dt>Deployment</dt><dd>{{ short(receipt.runtimeDeploymentId) }}</dd></div>
        <div><dt>Evidence</dt><dd>{{ short(receipt.workspaceSelectionRef) }}</dd></div>
      </dl>
    </div>
    <div v-if="errorMessage" class="error" role="alert">{{ errorMessage }}</div>
    <div v-if="['pending','conflict','expired','revoked'].includes(issueState)" class="state-banner" role="status" aria-live="polite">
      {{ issueState.toUpperCase() }}
    </div>
  </section>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { canValidateWorkspaceOne, shortReference } from './model.js'

const props = defineProps({
  actorLabel: { type: String, required: true },
  actorVerified: { type: Boolean, default: false },
  workspaces: { type: Array, default: () => [] },
  discovering: { type: Boolean, default: false },
  validating: { type: Boolean, default: false },
  validated: { type: Boolean, default: false },
  receipt: { type: Object, default: null },
  challenge: { type: Object, default: null },
  verification: { type: Object, default: null },
  authority: { type: Object, default: null },
  operation: { type: String, default: '' },
  issueState: { type: String, default: 'idle' },
  errorMessage: { type: String, default: '' },
})
const emit = defineEmits(['discover', 'validate', 'create-challenge', 'verify-challenge', 'bootstrap-authority'])
const selectedWorkspaceId = ref(null)
const confirmed = ref(false)
const challengeApproved = ref(false)
const verifyApproved = ref(false)
const bootstrapApproved = ref(false)
const workspaceOne = computed(() => props.workspaces.find((row) => row.workspaceId === 1))
const canValidate = computed(() => confirmed.value && selectedWorkspaceId.value === 1
  && canValidateWorkspaceOne(workspaceOne.value) && !props.validating && !props.validated)

const isEligible = canValidateWorkspaceOne
const short = shortReference
const capabilityLabel = (workspace) => workspace.capabilities.includes('domain:write') ? 'domain:write' : 'domain:read'
const requestValidation = () => {
  if (canValidate.value) emit('validate', { workspaceId: 1, confirmed: true })
}

watch(() => props.workspaces, () => {
  selectedWorkspaceId.value = null
  confirmed.value = false
  challengeApproved.value = false
  verifyApproved.value = false
  bootstrapApproved.value = false
}, { deep: true })
</script>

<style scoped lang="scss">
.activation-shell { max-width: 880px; margin: 0 auto; padding: clamp(1.25rem, 4vw, 3rem); color: var(--el-text-color-primary); font-family: system-ui, -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif; }
.hero { margin-bottom: 1.75rem; }
.eyebrow { color: var(--el-color-primary); font-size: .75rem; font-weight: 750; letter-spacing: .12em; }
h1 { margin: .35rem 0 .55rem; font-size: clamp(2rem, 5vw, 3.3rem); line-height: 1.03; letter-spacing: -.035em; }
.hero p, .support { color: var(--el-text-color-secondary); line-height: 1.55; }
.stage-list { list-style: none; padding: 0; display: grid; gap: .85rem; }
.stage-card { display: grid; grid-template-columns: 2.25rem 1fr; gap: .9rem; padding: 1.1rem; border: 1px solid var(--el-border-color-lighter); border-radius: 1.25rem; background: color-mix(in srgb, var(--el-bg-color) 88%, transparent); box-shadow: 0 12px 36px rgba(15, 23, 42, .06); backdrop-filter: blur(18px) saturate(150%); }
.stage-card.active { border-color: color-mix(in srgb, var(--el-color-primary) 38%, var(--el-border-color)); }
.stage-card.complete .stage-index { background: var(--el-color-success); color: white; }
.stage-card.locked { opacity: .68; box-shadow: none; }
.stage-index { width: 2.1rem; height: 2.1rem; display: grid; place-items: center; border-radius: 50%; background: var(--el-fill-color-light); font-weight: 750; }
.stage-content { min-width: 0; border: 0; padding: 0; margin: 0; }
.stage-content h2, .stage-content legend { margin: .2rem 0 .3rem; padding: 0; font-size: 1.08rem; font-weight: 700; }
.actor { margin: .25rem 0; font-weight: 650; }
.workspace-option { display: flex; align-items: center; gap: .8rem; min-height: 3.7rem; margin: .65rem 0; padding: .75rem; border: 1px solid var(--el-border-color); border-radius: 1rem; cursor: not-allowed; }
.workspace-option.eligible { cursor: pointer; }
.workspace-option.selected { border-color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
.workspace-copy { display: grid; gap: .2rem; flex: 1; }
.workspace-copy small { color: var(--el-text-color-secondary); }
.status-pill { padding: .25rem .5rem; border-radius: 999px; background: var(--el-fill-color-light); font-size: .72rem; }
.confirmation { display: flex; gap: .65rem; align-items: flex-start; margin: .9rem 0; line-height: 1.4; }
input { accent-color: var(--el-color-primary); min-width: 1rem; min-height: 1rem; }
.receipt, .error { margin-top: 1rem; padding: 1rem; border-radius: 1rem; }
.challenge { display: grid; gap: .65rem; margin-top: .75rem; padding: .85rem; border-radius: .9rem; background: var(--el-fill-color-light); }
.challenge code { overflow-wrap: anywhere; user-select: text; }
.state-banner { margin-top: .75rem; font-weight: 700; color: var(--el-color-warning-dark-2); }
.receipt { display: grid; gap: .35rem; color: var(--el-color-success-dark-2); background: var(--el-color-success-light-9); }
.receipt dl { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .45rem; margin: .5rem 0 0; }
.receipt dl div { min-width: 0; }
.receipt dt { font-size: .72rem; color: var(--el-text-color-secondary); }
.receipt dd { margin: .1rem 0 0; font-family: ui-monospace, SFMono-Regular, monospace; overflow-wrap: anywhere; }
.error { color: var(--el-color-danger); background: var(--el-color-danger-light-9); }
button:active { transform: scale(.98); }
@media (max-width: 600px) { .activation-shell { padding: 1rem; } .receipt dl { grid-template-columns: 1fr; } .status-pill { display: none; } }
@media (prefers-reduced-motion: reduce) { *, *::before, *::after { transition-duration: .01ms !important; animation-duration: .01ms !important; } button:active { transform: none; } }
@media (prefers-reduced-transparency: reduce) { .stage-card { backdrop-filter: none; background: var(--el-bg-color); } }
@media (prefers-contrast: more) { .stage-card { border-color: currentColor; box-shadow: none; } }
</style>
