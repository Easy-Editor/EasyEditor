import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const hostUrl = new URL('../src/editor/agent.ts', import.meta.url)
const workerUrl = new URL('../src/editor/agent.worker.ts', import.meta.url)
const hookUrl = new URL('../src/components/ai-chat/use-custom-chat.ts', import.meta.url)

test('Worker can prepare a plan but only the trusted host can execute it after confirmation', async () => {
  const host = await readFile(hostUrl, 'utf8')
  const worker = await readFile(workerUrl, 'utf8')
  const previewIndex = worker.indexOf('await capability.preview(')
  const proposalIndex = worker.indexOf("kind: 'proposal'")
  const authoritativePreviewIndex = host.indexOf('session.getPreparedPlanPreview(response.planId)')
  const summaryIndex = host.indexOf('createAgentPlanSummary(preview)')
  const confirmationIndex = host.indexOf('await awaitProposalConfirmation(')
  const executeIndex = host.indexOf('session.approveAndExecute(')

  assert.ok(previewIndex >= 0 && previewIndex < proposalIndex)
  assert.doesNotMatch(worker, /capability\.execute\s*\(/)
  assert.match(worker, /planId:\s*preview\.planId/)
  assert.doesNotMatch(worker, /\bpreview,\s*\n\s*\}/)
  assert.match(host, /AgentCapabilityError[^\n]+@easy-editor\/core\/instance/)
  assert.doesNotMatch(host, /AgentCapabilityError[^\n]+@easy-editor\/core\/agent-channel/)
  assert.match(host, /executionAuthority:\s*'host'/)
  assert.ok(authoritativePreviewIndex >= 0 && authoritativePreviewIndex < summaryIndex)
  assert.ok(confirmationIndex >= 0 && confirmationIndex < executeIndex)
  assert.match(host, /if \(!confirmed\)[\s\S]*dashboard\.agent\.rejected/)
  assert.match(host, /Date\.now\(\) >= proposal\.expiresAt/)
})

test('generation failures are known non-mutations while uncertain execution remains non-retryable', async () => {
  const host = await readFile(hostUrl, 'utf8')
  const worker = await readFile(workerUrl, 'utf8')

  assert.doesNotMatch(host, /toTransportFailure|let dispatched = false/)
  assert.match(worker, /lost proposal cannot mutate the document/)
  assert.match(host, /error\.committed \|\| error\.rollbackComplete === false/)
  assert.match(host, /'unknown'/)
  assert.doesNotMatch(host, /\bretry\b|setInterval/)
})

test('caller cancellation never hides an outcome-unknown result', async () => {
  const hook = await readFile(hookUrl, 'utf8')

  assert.match(hook, /controller\.signal\.aborted && !hasUnknownOutcome\(requestError\)/)
})
