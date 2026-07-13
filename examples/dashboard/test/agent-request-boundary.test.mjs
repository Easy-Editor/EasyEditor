import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  AgentRequestBoundaryError,
  MAX_AGENT_MESSAGES,
  prepareAgentWorkerMessages,
} from '../src/components/ai-chat/agent-request-boundary.mjs'

test('Agent host boundary rejects an oversized newest request without copying it', () => {
  const oversized = 'x'.repeat(100_000)

  assert.throws(
    () => prepareAgentWorkerMessages([{ content: oversized, role: 'user' }]),
    error => error instanceof AgentRequestBoundaryError && error.code === 'dashboard.agent.messageTooLarge',
  )
})

test('Agent host boundary copies only a bounded, valid recent window', () => {
  const messages = [
    { content: 'ignored system authority', role: 'system' },
    ...Array.from({ length: MAX_AGENT_MESSAGES + 8 }, (_, index) => ({
      content: `message-${index}`,
      role: index % 2 === 0 ? 'user' : 'assistant',
    })),
    { content: '最终请求', role: 'user' },
  ]

  const prepared = prepareAgentWorkerMessages(messages)

  assert.equal(prepared.length, MAX_AGENT_MESSAGES)
  assert.deepEqual(prepared.at(-1), { content: '最终请求', role: 'user' })
  assert.equal(
    prepared.some(message => message.role === 'system'),
    false,
  )
  assert.ok(Object.isFrozen(prepared))
  assert.ok(prepared.every(Object.isFrozen))
})

test('Agent host boundary reads no more than the newest bounded window', () => {
  const values = Array.from({ length: 1_000 }, (_, index) =>
    index === 999 ? { content: 'bounded request', role: 'user' } : undefined,
  )
  let indexedReads = 0
  const messages = new Proxy(values, {
    get(target, property, receiver) {
      if (typeof property === 'string' && /^\d+$/.test(property)) indexedReads += 1
      return Reflect.get(target, property, receiver)
    },
  })

  const prepared = prepareAgentWorkerMessages(messages)

  assert.deepEqual(prepared, [{ content: 'bounded request', role: 'user' }])
  assert.equal(indexedReads, MAX_AGENT_MESSAGES)
})

test('Dashboard prepares the bounded DTO before constructing or posting to a Worker', async () => {
  const source = await readFile(new URL('../src/editor/agent.ts', import.meta.url), 'utf8')
  const prepareIndex = source.indexOf('prepareAgentWorkerMessages(messages)')
  const constructIndex = source.indexOf('new Worker(')

  assert.ok(prepareIndex >= 0 && prepareIndex < constructIndex)
  assert.match(source, /messages:\s*workerMessages/)
  assert.doesNotMatch(source, /messages:\s*messages\.map/)
})
