import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PersistenceLineageContractError,
  createAgentProvenanceToken,
  createChildrenOrderSlotKey,
  createFieldSlotAliases,
  createFieldSlotKey,
  createMutationProvenance,
  createMutationProvenanceBatch,
  createNodeExistenceSlotKey,
  createNodeParentSlotKey,
  createNodeStructuralSlotKeys,
  createNodeSubtreeSlotKey,
  parseMutationProvenance,
  parseProvenanceToken,
  resolveProvenanceToken,
  toRfc6901Pointer,
} from '../src/editor/agent/persistence/provenance.mjs'

const authority = Object.freeze({
  projectId: 'project/id',
  branchId: 'main~blue',
})

test('field slot keys use canonical RFC6901 escaping for authority, node, and path segments', () => {
  assert.equal(toRfc6901Pointer([]), '')
  assert.equal(toRfc6901Pointer(['style', 'a/b', '~tone', '']), '/style/a~1b/~0tone/')
  assert.equal(
    createFieldSlotKey({
      ...authority,
      nodeId: '/node~1',
      root: 'props',
      path: ['style', 'a/b', '~tone', ''],
    }),
    'project~1id/main~0blue/~1node~01/props/style/a~1b/~0tone/',
  )

  assert.throws(
    () => createFieldSlotKey({ ...authority, nodeId: 'node', root: 'extra', path: ['title'] }),
    PersistenceLineageContractError,
  )
  assert.throws(
    () => createFieldSlotKey({ ...authority, nodeId: 'node', root: 'props', path: ['items', 0] }),
    PersistenceLineageContractError,
  )
})

test('field aliases include the aggregate, every ancestor, and the exact leaf in stable order', () => {
  assert.deepEqual(
    createFieldSlotAliases({
      projectId: 'project',
      branchId: 'main',
      nodeId: 'node',
      root: 'extras',
      path: ['dashboard', 'rect', 'width'],
    }),
    [
      'project/main/node/extras',
      'project/main/node/extras/dashboard',
      'project/main/node/extras/dashboard/rect',
      'project/main/node/extras/dashboard/rect/width',
    ],
  )
  assert.deepEqual(
    createFieldSlotAliases({
      projectId: 'project',
      branchId: 'main',
      nodeId: 'node',
      root: 'props',
      path: [],
    }),
    ['project/main/node/props'],
  )
})

test('structural aliases cover existence, parent, subtree, and parent children order', () => {
  const input = { projectId: 'project', branchId: 'main', nodeId: 'node/1' }
  assert.equal(createNodeExistenceSlotKey(input), 'project/main/node/node~11/existence')
  assert.equal(createNodeParentSlotKey(input), 'project/main/node/node~11/parent')
  assert.equal(createNodeSubtreeSlotKey(input), 'project/main/node/node~11/subtree')
  assert.equal(
    createChildrenOrderSlotKey({ projectId: 'project', branchId: 'main', parentId: 'root/1' }),
    'project/main/parent/root~11/children-order',
  )
  assert.deepEqual(createNodeStructuralSlotKeys(input), [
    'project/main/node/node~11/existence',
    'project/main/node/node~11/parent',
    'project/main/node/node~11/subtree',
  ])
})

test('provenance tokens distinguish human, external, unknown, and exact Agent call ownership', () => {
  assert.equal(createAgentProvenanceToken('call/7'), 'agent:call/7')
  assert.deepEqual(parseProvenanceToken('human'), { source: 'human' })
  assert.deepEqual(parseProvenanceToken('external'), { source: 'external' })
  assert.deepEqual(parseProvenanceToken('unknown'), { source: 'unknown' })
  assert.deepEqual(parseProvenanceToken('agent:call/7'), { source: 'agent', callId: 'call/7' })
  assert.throws(() => createAgentProvenanceToken(''), PersistenceLineageContractError)
  assert.throws(() => parseProvenanceToken('agent:'), PersistenceLineageContractError)
  assert.throws(() => parseProvenanceToken('system'), PersistenceLineageContractError)
})

test('ambiguous or incomplete attribution resolves to unknown instead of preserving a stale Agent token', () => {
  assert.equal(resolveProvenanceToken({ source: 'human' }), 'human')
  assert.equal(resolveProvenanceToken({ source: 'external' }), 'external')
  assert.equal(resolveProvenanceToken({ source: 'agent', callId: 'call-1' }), 'agent:call-1')
  assert.equal(resolveProvenanceToken({ source: 'agent' }), 'unknown')
  assert.equal(resolveProvenanceToken({ source: 'agent', callId: 'call-1', ambiguous: true }), 'unknown')
  assert.equal(resolveProvenanceToken({ source: 'human', listenerGap: true }), 'unknown')
  assert.equal(resolveProvenanceToken({ source: 'external', restartGap: true }), 'unknown')
  assert.equal(resolveProvenanceToken({ source: 'unclassified' }), 'unknown')
})

test('provenance DTOs are canonical, detached, structured-clone-safe, and generation scoped', () => {
  const slotKeys = [
    createNodeParentSlotKey({ projectId: 'project', branchId: 'main', nodeId: 'node' }),
    createNodeExistenceSlotKey({ projectId: 'project', branchId: 'main', nodeId: 'node' }),
    createNodeParentSlotKey({ projectId: 'project', branchId: 'main', nodeId: 'node' }),
  ]
  const batch = createMutationProvenanceBatch({
    projectId: 'project',
    branchId: 'main',
    draftGeneration: 4,
    slotKeys,
    source: 'agent',
    callId: 'call-1',
  })
  slotKeys[0] = 'mutated'

  assert.deepEqual(batch, [
    {
      schemaVersion: 1,
      projectId: 'project',
      branchId: 'main',
      slotKey: 'project/main/node/node/existence',
      draftGeneration: 4,
      token: 'agent:call-1',
    },
    {
      schemaVersion: 1,
      projectId: 'project',
      branchId: 'main',
      slotKey: 'project/main/node/node/parent',
      draftGeneration: 4,
      token: 'agent:call-1',
    },
  ])
  assert.deepEqual(structuredClone(batch), batch)
  assert.deepEqual(
    batch.map(entry => parseMutationProvenance(structuredClone(entry))),
    batch,
  )

  const unknown = createMutationProvenance({
    schemaVersion: 1,
    projectId: 'project',
    branchId: 'main',
    slotKey: 'project/main/node/node/subtree',
    draftGeneration: 5,
    token: resolveProvenanceToken({ source: 'agent', callId: 'call-1', ambiguous: true }),
  })
  assert.equal(unknown.token, 'unknown')

  assert.throws(() => createMutationProvenance({ ...unknown, draftGeneration: 4.5 }), PersistenceLineageContractError)
  assert.throws(() => createMutationProvenance({ ...unknown, token: 'agent:' }), PersistenceLineageContractError)
  assert.throws(() => createMutationProvenance({ ...unknown, extra: true }), PersistenceLineageContractError)
})
