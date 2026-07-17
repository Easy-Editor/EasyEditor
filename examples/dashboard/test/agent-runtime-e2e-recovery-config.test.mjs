import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  AGENT_RUNTIME_E2E_RECOVERY_STORAGE_KEY,
  AgentRuntimeE2ERecoveryConfigError,
  createAgentRuntimeE2ERecoveryBridge,
  parseAgentRuntimeE2ERecoveriesJson,
  readAgentRuntimeE2ERecoveries,
} from '../src/editor/agent/runtime-e2e/recovery-config.mjs'

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url))
const readRepositoryFile = relativePath => readFile(new URL(relativePath, `file://${repositoryRoot}/`), 'utf8')

const binding = Object.freeze({ projectId: 'project-1', branchId: 'main', sessionId: 'session-1' })

const recoveries = [
  {
    kind: 'compensation-conflict',
    recoveryId: 'conflict-1',
    taskId: 'task-1',
    message: '人工修改与补偿目标冲突',
    occurredAt: 20,
    conflictPaths: ['props.title', 'layout.x'],
  },
  {
    kind: 'applied-undurable',
    recoveryId: 'durability-1',
    taskId: 'task-2',
    callId: 'call-2',
    message: '画布已应用但持久化未确认',
    occurredAt: 10,
  },
]

test('missing recovery config returns an immutable empty list from the fixed sessionStorage key', () => {
  const requestedKeys = []
  const result = readAgentRuntimeE2ERecoveries({
    getItem(key) {
      requestedKeys.push(key)
      return null
    },
  })

  assert.equal(AGENT_RUNTIME_E2E_RECOVERY_STORAGE_KEY, 'easy-editor:agent-runtime:e2e-recoveries:v1')
  assert.deepEqual(requestedKeys, [AGENT_RUNTIME_E2E_RECOVERY_STORAGE_KEY])
  assert.deepEqual(result, [])
  assert.equal(Object.isFrozen(result), true)
})

test('valid recovery DTOs are exact, deterministic, and deeply immutable', () => {
  const parsed = parseAgentRuntimeE2ERecoveriesJson(JSON.stringify(recoveries))

  assert.deepEqual(
    parsed.map(recovery => recovery.recoveryId),
    ['durability-1', 'conflict-1'],
  )
  assert.deepEqual(parsed[1]?.conflictPaths, ['layout.x', 'props.title'])
  assert.equal(Object.isFrozen(parsed), true)
  assert.equal(Object.isFrozen(parsed[0]), true)
  assert.equal(Object.isFrozen(parsed[1]?.conflictPaths), true)
})

test('malformed, duplicate, and extra-field recovery configs fail closed with a typed error', () => {
  for (const value of [
    '{',
    JSON.stringify([{ ...recoveries[0], recoveryId: '' }]),
    JSON.stringify([recoveries[0], { ...recoveries[1], recoveryId: 'conflict-1' }]),
    JSON.stringify([{ ...recoveries[1], unexpected: true }]),
    JSON.stringify([{ ...recoveries[0], conflictPaths: ['layout.x', 'layout.x'] }]),
  ]) {
    assert.throws(
      () => parseAgentRuntimeE2ERecoveriesJson(value),
      error =>
        error instanceof AgentRuntimeE2ERecoveryConfigError &&
        ['invalid-json', 'invalid-recoveries'].includes(error.code),
    )
  }
})

test('recovery bridge pins the first binding and keeps terminal conflicts refresh-only', async () => {
  const bridge = createAgentRuntimeE2ERecoveryBridge(parseAgentRuntimeE2ERecoveriesJson(JSON.stringify(recoveries)))
  assert.deepEqual(
    (await bridge.list({ binding, runtime: {} })).map(recovery => recovery.recoveryId),
    ['durability-1', 'conflict-1'],
  )
  assert.deepEqual(await bridge.list({ binding: { ...binding, branchId: 'other' }, runtime: {} }), [])

  await assert.rejects(
    bridge.retry({
      binding,
      recoveryId: 'conflict-1',
      kind: 'compensation-conflict',
      action: 'retry-durability',
      runtime: {},
    }),
    /action does not match/,
  )
  await bridge.retry({
    binding,
    recoveryId: 'conflict-1',
    kind: 'compensation-conflict',
    action: 'refresh-conflict-report',
    runtime: {},
  })
  assert.deepEqual(
    (await bridge.list({ binding, runtime: {} })).map(recovery => recovery.recoveryId),
    ['durability-1', 'conflict-1'],
  )
  await assert.rejects(
    bridge.retry({
      binding,
      recoveryId: 'conflict-1',
      kind: 'compensation-conflict',
      action: 'retry-compensation',
      runtime: {},
    }),
    /action does not match/,
  )
})

test('recovery configuration remains behind a VITE_E2E-gated dynamic import', async () => {
  const entrySource = await readRepositoryFile('examples/dashboard/src/editor/agent/runtime-e2e/index.mjs')

  assert.match(entrySource, /import\.meta\.env\?\.VITE_E2E === '1'/)
  assert.match(entrySource, /return import\('\.\/recovery-config\.mjs'\)/)
  assert.doesNotMatch(entrySource, /^import .*recovery-config/m)
})
