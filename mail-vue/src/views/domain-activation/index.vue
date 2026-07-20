<template>
  <DomainWorkspaceSelector
    :actor-label="actorLabel" :actor-verified="actorVerified" :workspaces="discovery.workspaces"
    :discovering="phase === 'discovering'" :validating="phase === 'validating'"
    :validated="Boolean(authorization)" :receipt="receipt" :challenge="challenge"
    :verification="verification" :authority="authority" :operation="operation"
    :issue-state="issueState" :error-message="errorMessage"
    @discover="discover" @validate="validate" @create-challenge="createChallenge"
    @verify-challenge="verifyChallengeAction" @bootstrap-authority="bootstrapAuthorityAction" />
</template>

<script setup>
import { computed, onBeforeUnmount, reactive, ref } from 'vue'
import { useUserStore } from '@/store/user.js'
import { loginUserInfo } from '@/request/my.js'
import {
  bootstrapDomainAuthority, createDomainChallenge, discoverDomainWorkspaces,
  validateDomainWorkspace, verifyDomainChallenge,
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
const operation = ref('')
const issueState = ref('idle')
const errorMessage = ref('')
const actorLabel = computed(() => maskEmail(userStore.user?.email))
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
    issueState.value = 'complete'
    operation.value = ''
  } catch (error) { fail(error) }
}

onBeforeUnmount(() => {
  discovery.workspaces = []
  clearActivationContext()
  errorMessage.value = ''
  actorVerified.value = false
})
</script>
