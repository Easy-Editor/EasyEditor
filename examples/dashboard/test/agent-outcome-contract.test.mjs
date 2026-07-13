import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const hostUrl = new URL('../src/editor/agent.ts', import.meta.url)
const workerUrl = new URL('../src/editor/agent.worker.ts', import.meta.url)
const hookUrl = new URL('../src/components/ai-chat/use-custom-chat.ts', import.meta.url)

test('host marks every post-dispatch Worker or protocol failure as outcome unknown', async () => {
  const host = await readFile(hostUrl, 'utf8')
  const postIndex = host.indexOf('worker.postMessage(')
  const dispatchedIndex = host.indexOf('dispatched = true')
  const messageHandler = host.slice(
    host.indexOf("worker.addEventListener('message'"),
    host.indexOf("worker.addEventListener('error'"),
  )
  const errorHandler = host.slice(
    host.indexOf("worker.addEventListener('error'"),
    host.indexOf("worker.addEventListener('messageerror'"),
  )
  const messageErrorHandler = host.slice(
    host.indexOf("worker.addEventListener('messageerror'"),
    host.indexOf('worker.postMessage('),
  )

  assert.match(host, /let dispatched = false/)
  assert.ok(postIndex >= 0 && postIndex < dispatchedIndex)
  assert.match(messageHandler, /parseWorkerResponse/)
  assert.match(messageHandler, /toTransportFailure/)
  assert.match(messageHandler, /dispatched/)
  assert.match(errorHandler, /workerFailed/)
  assert.match(errorHandler, /toTransportFailure[\s\S]*dispatched/)
  assert.match(messageErrorHandler, /workerProtocol/)
  assert.match(messageErrorHandler, /toTransportFailure[\s\S]*dispatched/)
  assert.doesNotMatch(host, /\bretry\b|setInterval/)
})

test('Worker reports failures after execute receipt as outcome unknown', async () => {
  const worker = await readFile(workerUrl, 'utf8')
  const executeIndex = worker.indexOf('await capability.execute(')
  const committedIndex = worker.indexOf('committed = true')

  assert.match(worker, /let committed = false/)
  assert.ok(executeIndex >= 0 && executeIndex < committedIndex)
  assert.match(worker, /toSafeFailure\(error, committed\)/)
  assert.match(worker, /committed[\s\S]*outcome:\s*'unknown'/)
})

test('caller cancellation never hides an outcome-unknown result', async () => {
  const hook = await readFile(hookUrl, 'utf8')

  assert.match(hook, /controller\.signal\.aborted && !hasUnknownOutcome\(requestError\)/)
})
