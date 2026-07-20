import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const requestSource = readFileSync(fileURLToPath(new URL('../../request/nexora-domain-activation.js', import.meta.url)), 'utf8')
const componentSource = readFileSync(fileURLToPath(new URL('./DomainWorkspaceSelector.vue', import.meta.url)), 'utf8')
const viewSource = readFileSync(fileURLToPath(new URL('../../views/domain-activation/index.vue', import.meta.url)), 'utf8')

test('request surface uses exact staged endpoints and bodies', () => {
  assert.match(requestSource, /http\.get\('\/v3\/domain-authorities\/workspace-selector'/)
  assert.match(requestSource, /http\.post\('\/v3\/domain-authorities\/workspace-selector\/validate', \{ workspaceId: id \}/)
  assert.match(requestSource, /http\.post\('\/v3\/domain-ownership\/dns-challenges'/)
  assert.match(requestSource, /http\.post\('\/v3\/domain-ownership\/dns-challenges\/verify'/)
  assert.match(requestSource, /http\.post\('\/v3\/domain-authorities\/bootstrap'/)
  assert.match(requestSource, /workspaceId, domain, idempotencyKey, workspaceSelectionCredential/)
  assert.match(requestSource, /workspaceId, domain, challengeId, expectedGeneration, idempotencyKey, workspaceSelectionCredential/)
  for (const forbidden of ['localStorage', 'Authorization', 'document.cookie', 'console.log', 'console.error']) {
    assert.equal(requestSource.includes(forbidden), false, `request module must not contain ${forbidden}`)
  }
})

test('later stages require separate confirmation and cannot auto-run', () => {
  assert.match(componentSource, /:aria-disabled="!validated"/)
  assert.match(componentSource, /v-model="challengeApproved"/)
  assert.match(componentSource, /v-model="verifyApproved"/)
  assert.match(componentSource, /v-model="bootstrapApproved"/)
  assert.equal(componentSource.includes('watchEffect'), false)
  assert.equal(componentSource.includes('localStorage'), false)
})

test('discovery refreshes the actor through the existing authenticated axios request', () => {
  assert.match(viewSource, /import \{ loginUserInfo \} from '@\/request\/my\.js'/)
  assert.match(viewSource, /loginUserInfo\(\)/)
  assert.match(viewSource, /discoverWorkspaceAuthority\(discoverDomainWorkspaces, actor\)/)
  assert.doesNotMatch(viewSource, /Promise\.all/)
  for (const forbidden of ['localStorage', 'Authorization', 'document.cookie']) {
    assert.equal(viewSource.includes(forbidden), false)
  }
  assert.match(viewSource, /workspaceId: authorizedWorkspaceId\(\)/)
  assert.doesNotMatch(viewSource, /workspaceId:\s*1,\s*domain/)
})

test('expired authorization retains the pending challenge and requires explicit revalidation', () => {
  assert.match(viewSource, /issue\.state === 'expired' && challenge\.value && !verification\.value\) clearSelectionCredential\(\)/)
  assert.match(componentSource, /:disabled="!validated \|\| !verifyApproved"/)
  assert.equal(componentSource.includes('domainActivationRevalidateChallenge'), true)
})
