<template>
  <DomainWorkspaceSelector
    :actor-label="actorLabel" :actor-verified="actorVerified" :workspaces="discovery.workspaces"
    :discovering="phase === 'discovering'" :validating="phase === 'validating'"
    :validated="Boolean(authorization)" :receipt="receipt" :challenge="challenge"
    :verification="verification" :authority="authority" :operation="operation"
    :issue-state="issueState" :error-message="errorMessage"
    @discover="discover" @validate="validate" @create-challenge="createChallenge"
    @verify-challenge="verifyChallengeAction" @bootstrap-authority="bootstrapAuthorityAction" />

  <section v-if="oauthReady" class="oauth-card" aria-labelledby="gmail-readonly-title">
    <div class="oauth-index" aria-hidden="true">5</div>
    <div>
      <h2 id="gmail-readonly-title">Connect read-only Gmail</h2>
      <p>Google will be asked only for identity and Gmail read-only access. Sending, drafts, deletion, watch, and mailbox mutation are excluded.</p>
      <label class="oauth-confirmation">
        <input v-model="oauthApproved" type="checkbox" />
        <span>I approve read-only Gmail OAuth for this signed-in administrator account in Workspace 1.</span>
      </label>
      <el-button type="primary" :disabled="!oauthApproved || oauthPhase === 'starting'"
                 :loading="oauthPhase === 'starting'" @click="startGmailOAuth">
        Continue to Google
      </el-button>
      <p v-if="oauthError" class="oauth-error" role="alert">{{ oauthError }}</p>
    </div>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, reactive, ref } from 'vue'
import { useUserStore } from '@/store/user.js'
import { loginUserInfo } from '@/request/my.js'
import { accountList } from '@/request/account.js'
import { startReadOnlyGmailOnboarding } from '@/request/nexora-onboarding.js'
import { requireGoogleOAuthUrl } from '@/features/nexora-domain-activation/gmail-onboarding.js'
import {
  bootstrapDomainAuthority, createDomainChallenge, discoverDomainWorkspaces,
  readDomainAuthorityStatus, validateDomainWorkspace, verifyDomainChallenge,
} from '@/request/nexora-domain-activation.js'
import DomainWorkspaceSelector from '@/features/nexora-domain-activation/DomainWorkspaceSelector.vue'
import {
  bootstrapAuthority, discoverWorkspaceAuthority, issueChallenge,
  validateWorkspaceOne, verifyChallenge,
} from '@/features/nexora-domain-activation/flow.js'
import { activationIssue, maskEmail } from '@/features/nexora-domain-activation/model.js'

const userStore = useUserStore()
const phase = ref('idle')
const actorVerified = ref(false)
const discovery = reactive({ workspaces: [], selectionRequired: true })
const receipt = ref(null)
const authorization = ref(null)
const challenge = ref(null)
const verification = ref(null)
const authority = ref(null)
const existingAuthority = ref(null)
const operation = ref('')
const issueState = ref('idle')
const errorMessage = ref('')
const oauthApproved = ref(false)
const oauthPhase = ref('idle')
const oauthError = ref('')
const oauthIdempotencyKey = ref('')
const actorLabel = computed(() => maskEmail(userStore.user?.email))
const oauthReady = computed(() => Boolean(authority.value || existingAuthority.value?.verified))
const domain = 'fastonegroup.com'
const operationId = (kind) => `${kind}-${crypto.randomUUID()}`

function authorizedWorkspaceId() {
  const id = Number(authorization.value?.receipt?.workspace?.workspaceId)
  if (!Number.isInteger(id) || id <= 0) throw new Error('Server-validated Workspace authorization is required.')
  return id
}

function clearActivationContext() {
  authorization.value = null
  receipt.value = null
  challenge.value = null
  verification.value = null
  authority.value = null
  existingAuthority.value = null
  operation.value = ''
}

function clearSelectionCredential() {
  authorization.value = null
  receipt.value = null
  operation.value = ''
}

function fail(error) {
  const issue = activationIssue(error)
  if (issue.state === 'expired' && challenge.value && !verification.value) clearSelectionCredential()
  else clearActivationContext()
  issueState.value = issue.state
  phase.value = 'blocked'
  errorMessage.value = issue.message
}

async function discover() {
  phase.value = 'discovering'
  actorVerified.value = false
  clearActivationContext()
  errorMessage.value = ''
  try {
    const actor = await loginUserInfo()
    const result = await discoverWorkspaceAuthority(discoverDomainWorkspaces, actor)
    userStore.user = actor
    discovery.workspaces = result.workspaces
    discovery.selectionRequired = result.selectionRequired
    actorVerified.value = true
    phase.value = 'discovered'
  } catch (error) {
    discovery.workspaces = []
    phase.value = 'blocked'
    fail(error)
  }
}

async function validate(selection) {
  phase.value = 'validating'
  errorMessage.value = ''
  try {
    const validated = await validateWorkspaceOne({
      discovery,
      workspaceId: selection.workspaceId,
      confirmed: selection.confirmed,
      authenticatedActor: userStore.user,
      validate: validateDomainWorkspace,
    })
    receipt.value = validated.receipt
    authorization.value = validated
    existingAuthority.value = await readDomainAuthorityStatus({ workspaceId: authorizedWorkspaceId(), domain })
    issueState.value = 'authorized'
    phase.value = 'validated'
  } catch (error) {
    fail(error)
  }
}

async function createChallenge({ approved }) {
  operation.value = 'creating'
  try {
    challenge.value = await issueChallenge({
      authorized: authorization.value, approved,
      create: (workspaceSelectionCredential) => createDomainChallenge({
        workspaceId: authorizedWorkspaceId(), domain, idempotencyKey: operationId('challenge'), workspaceSelectionCredential,
      }),
    })
    issueState.value = 'pending'
    operation.value = ''
  } catch (error) { fail(error) }
}

async function verifyChallengeAction({ approved }) {
  operation.value = 'verifying'
  try {
    verification.value = await verifyChallenge({
      authorized: authorization.value, challenge: challenge.value, approved,
      verify: (workspaceSelectionCredential, pending) => verifyDomainChallenge({
        workspaceId: authorizedWorkspaceId(), domain, challengeId: pending.id, expectedGeneration: pending.generation,
        idempotencyKey: operationId('verify'), workspaceSelectionCredential,
      }),
    })
    issueState.value = 'verified'
    operation.value = ''
  } catch (error) { fail(error) }
}

async function bootstrapAuthorityAction({ approved }) {
  operation.value = 'bootstrapping'
  try {
    authority.value = await bootstrapAuthority({
      authorized: authorization.value, verification: verification.value, approved,
      bootstrap: (workspaceSelectionCredential) => bootstrapDomainAuthority({
        workspaceId: authorizedWorkspaceId(), domain, idempotencyKey: operationId('bootstrap'), workspaceSelectionCredential,
      }),
    })
    existingAuthority.value = { verified: true, authority: authority.value?.authority || null }
    issueState.value = 'complete'
    operation.value = ''
  } catch (error) { fail(error) }
}

async function startGmailOAuth() {
  if (!oauthApproved.value || oauthPhase.value === 'starting') return
  oauthPhase.value = 'starting'
  oauthError.value = ''
  try {
    const accounts = await accountList(0, 30)
    const actorEmail = String(userStore.user?.email || '').trim().toLowerCase()
    const account = accounts.find((row) => String(row.email || '').trim().toLowerCase() === actorEmail)
    if (!account) throw new Error('The signed-in administrator account is not available for OAuth.')
    const result = await startReadOnlyGmailOnboarding({
      workspaceId: authorizedWorkspaceId(),
      accountId: account.accountId,
      idempotencyKey: oauthIdempotencyKey.value || (oauthIdempotencyKey.value = operationId('gmail-readonly')),
    })
    window.location.assign(requireGoogleOAuthUrl(result?.authorizationUrl))
  } catch (error) {
    oauthPhase.value = 'blocked'
    oauthError.value = String(error?.message || 'Read-only Gmail authorization could not start.')
    if (oauthError.value.includes('nexora_onboarding_authorization_session_expired')) oauthIdempotencyKey.value = ''
  }
}

onBeforeUnmount(() => {
  discovery.workspaces = []
  clearActivationContext()
  errorMessage.value = ''
  actorVerified.value = false
  oauthApproved.value = false
  oauthError.value = ''
  oauthIdempotencyKey.value = ''
  existingAuthority.value = null
})
</script>

<style scoped>
.oauth-card { max-width: 880px; margin: 1rem auto; padding: 1.1rem; display: grid; grid-template-columns: 2.25rem 1fr; gap: .9rem; border: 1px solid var(--el-border-color-lighter); border-radius: 1.25rem; background: var(--el-bg-color); }
.oauth-index { width: 2.1rem; height: 2.1rem; display: grid; place-items: center; border-radius: 50%; background: var(--el-color-success); color: white; font-weight: 750; }
.oauth-card h2 { margin: .2rem 0 .3rem; font-size: 1.08rem; }
.oauth-card p { color: var(--el-text-color-secondary); line-height: 1.55; }
.oauth-confirmation { display: flex; gap: .65rem; align-items: flex-start; margin: .9rem 0; line-height: 1.4; }
.oauth-confirmation input { accent-color: var(--el-color-primary); min-width: 1rem; min-height: 1rem; }
.oauth-error { color: var(--el-color-danger) !important; }
</style>
