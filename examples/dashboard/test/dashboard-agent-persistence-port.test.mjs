import assert from 'node:assert/strict'
import test from 'node:test'

import { createDashboardAgentPersistencePort } from '../src/editor/agent/persistence/agent-persistence-port.mjs'

const binding = Object.freeze({
  projectId: 'project-agent-port',
  branchId: 'main',
  sessionId: 'session-1',
})

const readRequest = expectedPersistenceGeneration => ({
  schemaVersion: 1,
  ...binding,
  expectedPersistenceGeneration,
})

const batch = (batchId, expectedPersistenceGeneration, value = { phase: 'OBSERVE' }) => ({
  schemaVersion: 1,
  ...binding,
  batchId,
  expectedPersistenceGeneration,
  records: [{ recordId: 'journal-1', kind: 'journal', value }],
})

test('Dashboard AgentPersistencePort exposes only the runtime-facade read and commit surface', async () => {
  const calls = []
  const port = createDashboardAgentPersistencePort({
    async readAgentPersistence(request) {
      calls.push(['read', request])
      return { ...request, persistenceGeneration: 0, records: [] }
    },
    async commitAgentPersistence(request) {
      calls.push(['commit', request])
      return {
        schemaVersion: 1,
        batchId: request.batchId,
        status: 'committed',
        persistenceGeneration: 1,
      }
    },
  })

  assert.deepEqual(Object.keys(port).sort(), ['commit', 'read'])
  assert.equal(Object.isFrozen(port), true)
  assert.equal((await port.read(readRequest(0))).persistenceGeneration, 0)
  assert.equal((await port.commit(batch('batch-1', 0))).persistenceGeneration, 1)
  assert.deepEqual(
    calls.map(([method]) => method),
    ['read', 'commit'],
  )
  assert.throws(() => createDashboardAgentPersistencePort({}), /persistence-facade-readAgentPersistence-is-required/)
})

test('Dashboard AgentPersistencePort records bounded latency and result metadata without persistence payloads', async () => {
  const telemetry = []
  const port = createDashboardAgentPersistencePort(
    {
      async readAgentPersistence(request) {
        return { ...request, persistenceGeneration: 4, records: [{ recordId: 'private', value: 'secret' }] }
      },
      async commitAgentPersistence(request) {
        return {
          schemaVersion: 1,
          batchId: request.batchId,
          status: 'committed',
          persistenceGeneration: 5,
        }
      },
    },
    {
      telemetry: { record: event => telemetry.push(event) },
      now: (() => {
        let value = 10
        return () => value++
      })(),
    },
  )

  await port.read(readRequest(3))
  await port.commit(batch('batch-1', 4, { prompt: 'must-not-cross-telemetry' }))
  assert.deepEqual(telemetry, [
    {
      schemaVersion: 1,
      eventType: 'dashboard.persistence.read',
      timestampMs: 11,
      durationMs: 1,
      status: 'completed',
      sessionId: 'session-1',
      persistenceGeneration: 4,
      recordCount: 1,
    },
    {
      schemaVersion: 1,
      eventType: 'dashboard.persistence.commit',
      timestampMs: 13,
      durationMs: 1,
      status: 'committed',
      sessionId: 'session-1',
      persistenceGeneration: 5,
      recordCount: 1,
    },
  ])
  assert.doesNotMatch(JSON.stringify(telemetry), /private|secret|prompt|must-not-cross/u)
})

test('Dashboard AgentPersistencePort normalizes generation conflicts without dropping telemetry', async () => {
  const telemetry = []
  const port = createDashboardAgentPersistencePort(
    {
      async readAgentPersistence() {
        throw new Error('unused')
      },
      async commitAgentPersistence(request) {
        return {
          schemaVersion: 1,
          batchId: request.batchId,
          status: 'generation-conflict',
          persistenceGeneration: 8,
        }
      },
    },
    { telemetry: { record: event => telemetry.push(event) }, now: () => 20 },
  )

  assert.equal((await port.commit(batch('batch-conflict', 7))).status, 'generation-conflict')
  assert.deepEqual(telemetry, [
    {
      schemaVersion: 1,
      eventType: 'dashboard.persistence.commit',
      timestampMs: 20,
      durationMs: 0,
      status: 'rejected',
      sessionId: 'session-1',
      persistenceGeneration: 8,
      recordCount: 1,
      diagnosticCode: 'generation-conflict',
    },
  ])
})

test('Dashboard AgentPersistencePort business results ignore telemetry clock failures', async () => {
  let readCalls = 0
  let commitCalls = 0
  let sinkCalls = 0
  const port = createDashboardAgentPersistencePort(
    {
      async readAgentPersistence(request) {
        readCalls += 1
        return { ...request, persistenceGeneration: 4, records: [] }
      },
      async commitAgentPersistence(request) {
        commitCalls += 1
        return {
          schemaVersion: 1,
          batchId: request.batchId,
          status: 'committed',
          persistenceGeneration: 5,
        }
      },
    },
    {
      telemetry: {
        record: () => {
          sinkCalls += 1
          return Promise.reject(new Error('private persistence telemetry failure'))
        },
      },
      now: () => {
        throw new Error('private persistence telemetry clock failure')
      },
    },
  )

  assert.equal((await port.read(readRequest(3))).persistenceGeneration, 4)
  assert.equal((await port.commit(batch('batch-passive', 4))).persistenceGeneration, 5)
  assert.equal(readCalls, 1)
  assert.equal(commitCalls, 1)
  assert.equal(sinkCalls, 0)
})
