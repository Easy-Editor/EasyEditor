import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ResponseBodyBudgetError,
  readResponseTextWithinBudget,
} from '../src/components/ai-chat/response-body-boundary.mjs'

const encoder = new TextEncoder()

test('response boundary decodes a body exactly at the byte budget', async () => {
  const body = '你好'
  const bytes = encoder.encode(body)

  assert.equal(await readResponseTextWithinBudget(new Response(bytes), bytes.byteLength), body)
})

test('response boundary cancels an unknown-length stream immediately after it exceeds the budget', async () => {
  let cancelled = false
  let reads = 0
  const chunks = [encoder.encode('1234'), encoder.encode('5678'), encoder.encode('not-read')]
  const response = {
    body: {
      getReader: () => ({
        async cancel() {
          cancelled = true
        },
        async read() {
          const value = chunks[reads]
          reads += 1
          return value ? { done: false, value } : { done: true, value: undefined }
        },
        releaseLock() {},
      }),
    },
    headers: new Headers(),
  }

  await assert.rejects(
    readResponseTextWithinBudget(response, 6),
    error => error instanceof ResponseBodyBudgetError && error.code === 'dashboard.agent.responseTooLarge',
  )
  assert.equal(cancelled, true)
  assert.equal(reads, 2)
})

test('response boundary rejects an oversized declared length before reading', async () => {
  let reads = 0
  let cancelled = false
  const response = {
    body: {
      getReader: () => ({
        async cancel() {
          cancelled = true
        },
        async read() {
          reads += 1
          return { done: false, value: encoder.encode('never read') }
        },
        releaseLock() {},
      }),
    },
    headers: new Headers({ 'Content-Length': '100' }),
  }

  await assert.rejects(readResponseTextWithinBudget(response, 10), ResponseBodyBudgetError)
  assert.equal(cancelled, true)
  assert.equal(reads, 0)
})
