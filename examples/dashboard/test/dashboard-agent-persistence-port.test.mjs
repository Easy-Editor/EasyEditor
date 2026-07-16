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
