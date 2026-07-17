import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  AGENT_RUNTIME_E2E_SCRIPT_STORAGE_KEY,
  AgentRuntimeE2EScriptConfigError,
  DEFAULT_AGENT_RUNTIME_E2E_SCRIPT,
  parseAgentRuntimeE2EScriptJson,
  readAgentRuntimeE2EScript,
} from '../src/editor/agent/runtime-e2e/script-config.mjs'

const repositoryRoot = fileURLToPath(new URL('../../..', import.meta.url))
const readRepositoryFile = relativePath => readFile(new URL(relativePath, `file://${repositoryRoot}/`), 'utf8')

test('missing sessionStorage entry returns the finite default BLUEPRINT and PLAN_STEP completion script', () => {
  const requestedKeys = []
  const result = readAgentRuntimeE2EScript({
    getItem(key) {
      requestedKeys.push(key)
      return null
    },
  })

  assert.equal(AGENT_RUNTIME_E2E_SCRIPT_STORAGE_KEY, 'easy-editor:agent-runtime:e2e-steps:v1')
  assert.deepEqual(requestedKeys, [AGENT_RUNTIME_E2E_SCRIPT_STORAGE_KEY])
  assert.equal(result, DEFAULT_AGENT_RUNTIME_E2E_SCRIPT)
  assert.deepEqual(
    result.map(step => step.expectedPhase),
    ['BLUEPRINT', 'PLAN_STEP'],
  )
  assert.deepEqual(
    result.flatMap(step => step.events.map(event => event.kind)),
    ['blueprint', 'complete'],
  )
  assert.equal(Object.isFrozen(result), true)
  assert.equal(Object.isFrozen(result[0]), true)
  assert.doesNotThrow(() => structuredClone(result))
})

test('explicit multi-turn JSON is read through the fixed sessionStorage key and returned as an immutable clone', () => {
  const explicit = [
    {
      expectedPhase: 'BLUEPRINT',
      events: [{ schemaVersion: 1, kind: 'blueprint', summary: 'Inspect and update the target.' }],
    },
    {
      expectedPhase: 'PLAN_STEP',
      events: [
        {
          schemaVersion: 1,
          kind: 'tool-call',
          call: {
            schemaVersion: 1,
            capability: 'screen.applyChangeSet',
            arguments: { schemaVersion: 1, documentId: 'screen-1', operations: [] },
            expectedRevision: 'revision-1',
          },
        },
      ],
    },
    {
      expectedPhase: 'PLAN_STEP',
      events: [{ schemaVersion: 1, kind: 'complete', summary: 'Target updated.' }],
    },
  ]
  const serialized = JSON.stringify(explicit)
  const result = readAgentRuntimeE2EScript({
    getItem: key => {
      assert.equal(key, AGENT_RUNTIME_E2E_SCRIPT_STORAGE_KEY)
      return serialized
    },
  })

  assert.deepEqual(result, explicit)
  assert.notEqual(result, explicit)
  assert.equal(Object.isFrozen(result), true)
  assert.equal(Object.isFrozen(result[1].events[0].call.arguments), true)
})

test('pure parser reports malformed JSON with a typed and storage-key-specific error', () => {
  assert.throws(
    () => parseAgentRuntimeE2EScriptJson('{"expectedPhase":'),
    error =>
      error instanceof AgentRuntimeE2EScriptConfigError &&
      error.code === 'invalid-json' &&
      error.cause instanceof SyntaxError &&
      error.message.includes(AGENT_RUNTIME_E2E_SCRIPT_STORAGE_KEY),
  )
})

test('pure parser routes malformed DTOs through the clone-safe step validator', () => {
  for (const value of [
    { expectedPhase: 'BLUEPRINT', events: [] },
    [{ expectedPhase: 'BLUEPRINT' }],
    [{ expectedPhase: 'UNKNOWN', events: [] }],
    [{ expectedPhase: 'BLUEPRINT', events: [], matchRequest: true }],
  ]) {
    assert.throws(
      () => parseAgentRuntimeE2EScriptJson(JSON.stringify(value)),
      error =>
        error instanceof AgentRuntimeE2EScriptConfigError &&
        error.code === 'invalid-script' &&
        error.cause?.code === 'invalid-steps' &&
        error.message.includes(AGENT_RUNTIME_E2E_SCRIPT_STORAGE_KEY),
    )
  }
})

test('sessionStorage access failures stay typed and do not fall back silently', () => {
  const failure = new DOMException('storage disabled', 'SecurityError')
  assert.throws(
    () =>
      readAgentRuntimeE2EScript({
        getItem() {
          throw failure
        },
      }),
    error =>
      error instanceof AgentRuntimeE2EScriptConfigError &&
      error.code === 'storage-read-failed' &&
      error.cause === failure,
  )
})

test('script configuration remains behind a VITE_E2E-gated dynamic import', async () => {
  const [entrySource, configSource] = await Promise.all([
    readRepositoryFile('examples/dashboard/src/editor/agent/runtime-e2e/index.mjs'),
    readRepositoryFile('examples/dashboard/src/editor/agent/runtime-e2e/script-config.mjs'),
  ])

  assert.match(entrySource, /import\.meta\.env\?\.VITE_E2E === '1'/)
  assert.match(entrySource, /return import\('\.\/script-config\.mjs'\)/)
  assert.doesNotMatch(entrySource, /^import .*script-config/m)
  assert.match(configSource, /cloneAgentRuntimeE2ESteps\(parsed\)/)
  assert.doesNotMatch(configSource, /localStorage|document\.|fetch\(/)
})
