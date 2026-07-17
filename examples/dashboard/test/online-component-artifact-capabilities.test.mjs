import assert from 'node:assert/strict'
import test from 'node:test'

import {
  ONLINE_ARTIFACT_FAILURE_CODE,
  classifyOnlineArtifactCoreFailure,
  createDashboardOnlineArtifactCapabilityService,
} from '../src/editor/agent/capabilities/artifact/index.mjs'
import { validateArtifactRecord } from '../src/editor/agent/online-components/artifact-contracts.mjs'
import { scanArtifactSource } from '../src/editor/agent/online-components/artifact-source.mjs'
import { classifyReceiptRecovery } from '../src/editor/agent/persistence/receipt-ledger.mjs'

const authority = Object.freeze({
  projectId: 'project-online',
  branchId: 'branch-main',
  sessionId: 'session-1',
  taskId: 'task-1',
})

const source = label =>
  `export default { mount(root, ctx) { root.textContent = ${JSON.stringify(label)} }, update(root, ctx) {}, destroy(root, ctx) {} }`

const createCall = (overrides = {}) => ({
  schemaVersion: 1,
  ...authority,
  stepId: 'step-1',
  callId: 'create-online-1',
  capability: 'artifact.createOnline',
  expectedRevision: 'revision-0',
  arguments: {
    schemaVersion: 1,
    documentId: 'document-1',
    parentId: 'root-1',
    position: { place: 'last' },
    rect: { x: 10, y: 20, width: 320, height: 120 },
    props: { title: 'Runtime KPI' },
    source: source('v1'),
    css: ':host { display: block; }',
    safeManifest: { schemaVersion: 1, title: 'Runtime KPI' },
    dependencies: [{ package: '@scope/chart-card', range: '^1.2.0' }],
  },
  ...overrides,
})

const reviseCall = (overrides = {}) => ({
  ...createCall(),
  callId: 'revise-online-1',
  capability: 'artifact.reviseOnline',
  expectedRevision: 'revision-1',
  arguments: {
    schemaVersion: 1,
    nodeId: 'generated-node-existing',
    source: source('v2'),
    css: ':host { color: red; }',
    safeManifest: { schemaVersion: 1, title: 'Runtime KPI v2' },
    dependencies: [{ package: '@scope/chart-card', range: '^1.2.0' }],
  },
  ...overrides,
})

const sha256Sri = async bytes => {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))
  return `sha256-${Buffer.from(digest).toString('base64')}`
}

const dependency = async (overrides = {}) => {
  const bytes = Buffer.from('export default { draw() {} }')
  return {
    package: '@scope/chart-card',
    range: '^1.2.0',
    exactVersion: '1.2.3',
    finalUrl: 'https://cdn.example.test/@scope/chart-card@1.2.3/index.mjs',
    integrity: await sha256Sri(bytes),
    cached: false,
    module: {
      format: 'bundled-esm',
      contentType: 'text/javascript',
      encoding: 'base64',
      byteLength: bytes.byteLength,
      bytes: bytes.toString('base64'),
    },
    ...overrides,
  }
}

const onlineRef = (overrides = {}) => ({
  artifactId: 'artifact-existing',
  sourceRevision: 'revision-existing',
  logicalComponentId: 'logical-existing',
  sourceIntegrity: `sha256:${'a'.repeat(64)}`,
  target: { kind: 'online' },
  ...overrides,
})

const createHarness = async ({
  coreFailure = null,
  coreResultMutator = null,
  durableFailure = null,
  resolverResult,
} = {}) => {
  const artifacts = new Map()
  const batches = []
  const coreCalls = []
  const resolverCalls = []
  const lineage = new Map()
  let generation = 0
  let currentRef = onlineRef()

  const artifactKey = value => `${value.projectId}:${value.artifactId}:${value.sourceRevision}`
  const persistence = {
    async createArtifact(value) {
      const artifact = validateArtifactRecord(value)
      scanArtifactSource(artifact.source)
      const key = artifactKey(artifact)
      const existing = artifacts.get(key)
      if (existing) {
        assert.deepEqual(artifact, existing)
        return { schemaVersion: 1, status: 'reconciled', artifact: existing }
      }
      artifacts.set(key, artifact)
      return { schemaVersion: 1, status: 'created', artifact }
    },
    async readArtifact(request) {
      return artifacts.get(artifactKey(request)) ?? null
    },
    async recoverDurableAgentReceipt({ callId }) {
      const evidence = lineage.get(callId)
      return evidence ? classifyReceiptRecovery(evidence) : { classification: 'missing' }
    },
    async runDurableAgentWrite(operation) {
      const draft = {
        projectId: authority.projectId,
        branchId: authority.branchId,
        draftGeneration: generation,
        activeDocument: { documentId: 'document-1', fileName: 'document-1', index: 0 },
        projectSchema: { componentsTree: [{ id: 'root-1', componentName: 'Root', children: [] }] },
      }
      let intent = null
      return operation({
        draft,
        async recordIntent(value) {
          intent = structuredClone(value)
          lineage.set(value.callId, {
            projectId: value.projectId,
            branchId: value.branchId,
            callId: value.callId,
            receiptIntent: intent,
            receipt: null,
            applyWitness: null,
            failureWitness: null,
          })
          return value
        },
        async commitBatch(batch) {
          batches.push(structuredClone(batch))
          if (durableFailure === 'before-commit') throw new Error('durable failure')
          generation += 1
          lineage.set(batch.callId, {
            projectId: batch.projectId,
            branchId: batch.branchId,
            callId: batch.callId,
            receiptIntent: intent,
            receipt: structuredClone(batch.receipt),
            applyWitness: batch.receipt.status === 'applied' ? structuredClone(batch.witness) : null,
            failureWitness: batch.receipt.status === 'applied' ? null : structuredClone(batch.witness),
          })
          if (durableFailure === 'ack-loss') throw new Error('ack lost')
          return {
            schemaVersion: 1,
            status: 'committed',
            receipt: structuredClone(batch.receipt),
            draft: { ...draft, draftGeneration: generation, projectSchema: structuredClone(batch.projectSchema) },
          }
        },
      })
    },
  }

  const core = {
    async prepareCreate(input) {
      coreCalls.push({ method: 'prepareCreate', input: structuredClone(input) })
      return {
        schemaVersion: 1,
        baseRevision: 'revision-0',
        documentId: input.documentId,
        nodeId: input.nodeId,
        baseMutationVersion: 0,
        previousArtifactRef: null,
      }
    },
    async prepareRevise(input) {
      coreCalls.push({ method: 'prepareRevise', input: structuredClone(input) })
      return {
        schemaVersion: 1,
        baseRevision: 'revision-1',
        documentId: 'document-1',
        nodeId: input.nodeId,
        baseMutationVersion: 1,
        previousArtifactRef: currentRef,
      }
    },
    async createOnline(input) {
      coreCalls.push({ method: 'createOnline', input: structuredClone(input) })
      if (coreFailure) throw coreFailure
      currentRef = input.artifactRef
      const result = {
        schemaVersion: 1,
        revision: 'revision-1',
        documentId: 'document-1',
        nodeId: input.nodeId,
        componentName: 'GeneratedMaterialHost',
        coreMutationVersion: 1,
        activeDocument: { documentId: 'document-1', fileName: 'document-1', index: 0 },
        projectSchema: {
          componentsTree: [
            {
              id: 'root-1',
              componentName: 'Root',
              children: [
                {
                  id: input.nodeId,
                  componentName: 'GeneratedMaterialHost',
                  $agent: { schemaVersion: 1, artifactRef: input.artifactRef },
                },
              ],
            },
          ],
        },
        affectedSlotKeys: [
          `${authority.projectId}/${authority.branchId}/node/${input.nodeId}/existence`,
          `${authority.projectId}/${authority.branchId}/parent/root-1/children-order`,
        ],
      }
      return coreResultMutator ? coreResultMutator(structuredClone(result)) : result
    },
    async reviseOnline(input) {
      coreCalls.push({ method: 'reviseOnline', input: structuredClone(input) })
      if (coreFailure) throw coreFailure
      currentRef = input.artifactRef
      const result = {
        schemaVersion: 1,
        revision: 'revision-2',
        documentId: 'document-1',
        nodeId: input.nodeId,
        componentName: 'GeneratedMaterialHost',
        coreMutationVersion: 2,
        activeDocument: { documentId: 'document-1', fileName: 'document-1', index: 0 },
        projectSchema: {
          componentsTree: [
            {
              id: 'root-1',
              componentName: 'Root',
              children: [
                {
                  id: input.nodeId,
                  componentName: 'GeneratedMaterialHost',
                  $agent: { schemaVersion: 1, artifactRef: input.artifactRef },
                },
              ],
            },
          ],
        },
        affectedSlotKeys: [`${authority.projectId}/${authority.branchId}/${input.nodeId}/extras/$agent`],
      }
      return coreResultMutator ? coreResultMutator(structuredClone(result)) : result
    },
    async captureProject() {
      return {
        schemaVersion: 1,
        revision: 'revision-0',
        documentId: 'document-1',
        coreMutationVersion: 0,
        activeDocument: { documentId: 'document-1', fileName: 'document-1', index: 0 },
        projectSchema: { componentsTree: [{ id: 'root-1', componentName: 'Root', children: [] }] },
      }
    },
  }

  const resolved = resolverResult ?? (await dependency())
  const resolver = {
    async resolve(input) {
      resolverCalls.push(structuredClone(input))
      return resolved
    },
  }
  const service = createDashboardOnlineArtifactCapabilityService({
    authority,
    core,
    persistence,
    resolver,
    now: () => 123,
  })
  return { artifacts, batches, coreCalls, lineage, persistence, resolverCalls, service }
}

test('createOnline locks dependencies, persists the immutable artifact first, and writes only the trusted proxy ref', async () => {
  const harness = await createHarness()
  const result = await harness.service.createOnline(createCall())

  assert.equal(result.status, 'applied')
  assert.equal(result.output.schemaVersion, 1)
  assert.equal(result.output.componentName, 'GeneratedMaterialHost')
  assert.equal(result.output.artifactRef.target.kind, 'online')
  assert.equal(harness.artifacts.size, 1)
  assert.deepEqual(harness.resolverCalls, [{ package: '@scope/chart-card', range: '^1.2.0' }])

  const artifact = [...harness.artifacts.values()][0]
  assert.equal(artifact.sourceIntegrity, result.output.artifactRef.sourceIntegrity)
  assert.equal(artifact.lockedDependencies[0].exactVersion, '1.2.3')
  assert.match(artifact.dependencyLockDigest, /^sha256:[a-f0-9]{64}$/u)
  assert.equal(harness.coreCalls.find(call => call.method === 'createOnline').input.componentName, undefined)
  assert.equal(harness.coreCalls.find(call => call.method === 'createOnline').input.artifactRef.target.kind, 'online')

  const batch = harness.batches.at(-1)
  assert.deepEqual(batch.artifactRefs, [
    {
      ownerType: 'working-draft',
      ownerId: authority.branchId,
      artifactId: artifact.artifactId,
      sourceRevision: artifact.sourceRevision,
    },
  ])
  assert.deepEqual(batch.artifactRefDeletes, [])
})

test('resolver outputs are exact data DTOs and forged module SRI is rejected before artifact or Core mutation', async () => {
  const valid = await dependency()
  const accessor = { ...valid }
  Object.defineProperty(accessor, 'integrity', { enumerable: true, get: () => valid.integrity })
  const invalidResults = [
    { ...valid, extra: 'https://evil.test' },
    { ...valid, integrity: `sha256-${'A'.repeat(43)}=` },
    accessor,
  ]

  for (const resolverResult of invalidResults) {
    const harness = await createHarness({ resolverResult })
    await assert.rejects(
      harness.service.createOnline(createCall()),
      /dependency|integrity|json|data propert|contract/iu,
    )
    assert.equal(harness.artifacts.size, 0)
    assert.equal(
      harness.coreCalls.some(call => call.method === 'createOnline'),
      false,
    )
  }
})

test('Core rollback leaves an unrooted artifact and commits a terminal non-applied receipt', async () => {
  const harness = await createHarness({ coreFailure: new Error('Core rejected insert') })
  const result = await harness.service.createOnline(createCall())

  assert.equal(result.status, 'not-applied')
  assert.equal(result.failure.code, ONLINE_ARTIFACT_FAILURE_CODE.coreTransactionFailed)
  assert.equal(harness.artifacts.size, 1)
  assert.equal(harness.batches.length, 1)
  assert.deepEqual(harness.batches[0].artifactRefs, [])
  assert.deepEqual(harness.batches[0].artifactRefDeletes, [])
  assert.equal(harness.batches[0].receipt.status, 'not-applied')
})

test('durable failure after Core apply is applied-undurable and a retry never repeats the Core effect', async () => {
  const harness = await createHarness({ durableFailure: 'before-commit' })
  const first = await harness.service.createOnline(createCall())
  assert.equal(first.status, 'indeterminate')
  assert.equal(first.failure.code, ONLINE_ARTIFACT_FAILURE_CODE.appliedUndurable)
  assert.equal(first.failure.details.requiredPause, true)
  assert.equal(harness.coreCalls.filter(call => call.method === 'createOnline').length, 1)

  const second = await harness.service.createOnline(createCall())
  assert.equal(second.status, 'indeterminate')
  assert.equal(second.failure.code, ONLINE_ARTIFACT_FAILURE_CODE.indeterminateReceipt)
  assert.equal(harness.coreCalls.filter(call => call.method === 'createOnline').length, 1)
})

test('durable ACK loss recovers the original output and does not resolve, create, or apply twice', async () => {
  const harness = await createHarness({ durableFailure: 'ack-loss' })
  const first = await harness.service.createOnline(createCall())
  assert.equal(first.status, 'indeterminate')
  assert.equal(first.failure.code, ONLINE_ARTIFACT_FAILURE_CODE.appliedUndurable)

  const second = await harness.service.createOnline(createCall())
  assert.equal(second.status, 'applied')
  assert.equal(second.output.componentName, 'GeneratedMaterialHost')
  assert.equal(harness.resolverCalls.length, 1)
  assert.equal(harness.artifacts.size, 1)
  assert.equal(harness.coreCalls.filter(call => call.method === 'createOnline').length, 1)
})

test('committed receipt recovery is bound to full call semantics and returns the exact original output shape', async () => {
  const harness = await createHarness()
  const first = await harness.service.createOnline(createCall())
  const recovered = await harness.service.createOnline(createCall())

  assert.deepEqual(recovered, first)
  assert.equal(recovered.output.kind, 'online-artifact-post-images')

  const alteredCalls = [
    createCall({ expectedRevision: 'revision-attacker' }),
    createCall({ arguments: { ...createCall().arguments, source: source('attacker') } }),
    createCall({
      arguments: {
        ...createCall().arguments,
        dependencies: [{ package: '@scope/chart-card', range: '^9.0.0' }],
      },
    }),
  ]
  for (const call of alteredCalls) {
    const rejected = await harness.service.createOnline(call)
    assert.equal(rejected.status, 'indeterminate')
    assert.equal(rejected.failure.code, ONLINE_ARTIFACT_FAILURE_CODE.indeterminateReceipt)
  }
  assert.equal(harness.resolverCalls.length, 1)
  assert.equal(harness.coreCalls.filter(call => call.method === 'createOnline').length, 1)
})

test('artifact receipt query verifies prepared-hash lineage and ignores non-artifact durable receipts', async () => {
  const harness = await createHarness()
  await harness.service.createOnline(createCall())
  const authorityQuery = {
    projectId: authority.projectId,
    branchId: authority.branchId,
    callId: createCall().callId,
  }
  const recovered = await harness.service.queryReceipt(authorityQuery)
  assert.equal(recovered.status, 'applied')
  assert.equal(recovered.callId, createCall().callId)

  const stored = harness.lineage.get(createCall().callId)
  stored.receiptIntent.preImages.expectedRevision = 'tampered-revision'
  const tampered = await harness.service.queryReceipt(authorityQuery)
  assert.equal(tampered.status, 'indeterminate')
  assert.equal(tampered.failure.code, ONLINE_ARTIFACT_FAILURE_CODE.indeterminateReceipt)

  harness.lineage.set('screen-receipt', {
    projectId: authority.projectId,
    branchId: authority.branchId,
    callId: 'screen-receipt',
    receiptIntent: {
      ...stored.receiptIntent,
      callId: 'screen-receipt',
      preImages: { kind: 'screen-pre-images' },
    },
    receipt: { ...stored.receipt, callId: 'screen-receipt' },
    applyWitness: { ...stored.applyWitness, callId: 'screen-receipt' },
    failureWitness: null,
  })
  assert.equal(
    await harness.service.queryReceipt({
      projectId: authority.projectId,
      branchId: authority.branchId,
      callId: 'screen-receipt',
    }),
    null,
  )
})

test('forged Core post-state cannot be durably acknowledged as an applied online artifact', async () => {
  const mutators = [
    result => ({ ...result, revision: 'revision-0' }),
    result => ({ ...result, coreMutationVersion: 0 }),
    result => {
      result.projectSchema.componentsTree[0].children[0].componentName = 'AttackerMaterial'
      return result
    },
    result => {
      result.projectSchema.componentsTree[0].children[0].$agent.artifactRef = onlineRef({
        artifactId: 'artifact-attacker',
      })
      return result
    },
    result => {
      result.projectSchema.componentsTree[0].children = []
      return result
    },
    result => {
      const node = result.projectSchema.componentsTree[0].children[0]
      node.artifactRef = structuredClone(node.$agent.artifactRef)
      return result
    },
    result => {
      const node = result.projectSchema.componentsTree[0].children[0]
      node.extra = { artifactRef: structuredClone(node.$agent.artifactRef) }
      return result
    },
  ]

  for (const coreResultMutator of mutators) {
    const harness = await createHarness({ coreResultMutator })
    const result = await harness.service.createOnline(createCall())
    assert.equal(result.status, 'indeterminate')
    assert.equal(result.failure.code, ONLINE_ARTIFACT_FAILURE_CODE.appliedUndurable)
    assert.equal(harness.batches.length, 0)
  }
})

test('raw Core transaction failures classify committed, rollback-incomplete, and generic outcomes without retry ambiguity', async () => {
  assert.equal(
    classifyOnlineArtifactCoreFailure(
      Object.assign(new Error('observer failed'), { name: 'TransactionCommittedError', committed: true }),
    ),
    'applied',
  )
  assert.equal(
    classifyOnlineArtifactCoreFailure(
      Object.assign(new Error('rollback failed'), {
        name: 'TransactionRollbackIncompleteError',
        rollbackComplete: false,
      }),
    ),
    'indeterminate',
  )
  assert.equal(classifyOnlineArtifactCoreFailure(new Error('rolled back')), 'not-applied')

  const committed = await createHarness({
    coreFailure: Object.assign(new Error('observer failed'), {
      name: 'TransactionCommittedError',
      committed: true,
    }),
  })
  const committedResult = await committed.service.createOnline(createCall())
  assert.equal(committedResult.failure.code, ONLINE_ARTIFACT_FAILURE_CODE.appliedUndurable)
  assert.equal(committed.batches.length, 0)

  const rollbackIncomplete = await createHarness({
    coreFailure: Object.assign(new Error('rollback failed'), {
      name: 'TransactionRollbackIncompleteError',
      rollbackComplete: false,
    }),
  })
  const rollbackResult = await rollbackIncomplete.service.createOnline(createCall())
  assert.equal(rollbackResult.failure.code, ONLINE_ARTIFACT_FAILURE_CODE.indeterminateCoreOutcome)
  assert.equal(rollbackIncomplete.batches.length, 0)
})

test('reviseOnline preserves artifact identity, creates a superseding revision, and atomically replaces the draft root', async () => {
  const harness = await createHarness()
  const result = await harness.service.reviseOnline(reviseCall())

  assert.equal(result.status, 'applied')
  assert.equal(result.output.componentName, 'GeneratedMaterialHost')
  assert.equal(result.output.artifactRef.artifactId, 'artifact-existing')
  assert.equal(result.output.artifactRef.logicalComponentId, 'logical-existing')
  assert.notEqual(result.output.artifactRef.sourceRevision, 'revision-existing')
  const artifact = [...harness.artifacts.values()][0]
  assert.deepEqual(artifact.supersedes, {
    artifactId: 'artifact-existing',
    sourceRevision: 'revision-existing',
    logicalComponentId: 'logical-existing',
    sourceIntegrity: `sha256:${'a'.repeat(64)}`,
  })
  const batch = harness.batches.at(-1)
  assert.deepEqual(batch.artifactRefDeletes, [
    {
      ownerType: 'working-draft',
      ownerId: authority.branchId,
      artifactId: 'artifact-existing',
      sourceRevision: 'revision-existing',
    },
  ])
  assert.equal(batch.artifactRefs[0].artifactId, 'artifact-existing')
  assert.equal(batch.artifactRefs[0].sourceRevision, artifact.sourceRevision)
})

test('call and dependency request DTOs reject extra fields, accessors, duplicates, and caller-controlled proxy identity', async () => {
  const invalidCalls = [
    createCall({ componentName: 'AttackerMaterial' }),
    createCall({ arguments: { ...createCall().arguments, componentName: 'AttackerMaterial' } }),
    createCall({ arguments: { ...createCall().arguments, artifactRef: onlineRef() } }),
    createCall({
      arguments: {
        ...createCall().arguments,
        dependencies: [
          { package: '@scope/chart-card', range: '^1.2.0' },
          { package: '@scope/chart-card', range: '^2.0.0' },
        ],
      },
    }),
  ]
  const accessorArguments = createCall().arguments
  Object.defineProperty(accessorArguments, 'source', { enumerable: true, get: () => source('getter') })
  invalidCalls.push(createCall({ arguments: accessorArguments }))

  for (const call of invalidCalls) {
    const harness = await createHarness()
    await assert.rejects(harness.service.createOnline(call), /invalid|contract|field|data propert|duplicate/iu)
    assert.equal(harness.resolverCalls.length, 0)
    assert.equal(harness.artifacts.size, 0)
  }
})

test('resolver cannot persist dependency modules that fail fatal UTF-8 decoding', async () => {
  const bytes = Buffer.from([0xc3, 0x28])
  const resolverResult = await dependency({
    integrity: await sha256Sri(bytes),
    module: {
      format: 'bundled-esm',
      contentType: 'text/javascript',
      encoding: 'base64',
      byteLength: bytes.byteLength,
      bytes: bytes.toString('base64'),
    },
  })
  const harness = await createHarness({ resolverResult })
  await assert.rejects(harness.service.createOnline(createCall()), /utf8|dependency|contract/iu)
  assert.equal(harness.artifacts.size, 0)
  assert.equal(
    harness.coreCalls.some(call => call.method === 'createOnline'),
    false,
  )
})
