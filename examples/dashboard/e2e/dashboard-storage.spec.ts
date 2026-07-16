import { expect, test } from '@playwright/test'

test('real IndexedDB preserves project CAS and Agent persistence across coordinator restarts', async ({ page }) => {
  await page.goto('/')

  const result = await page.evaluate(async () => {
    const storage = await import('/src/lib/storage/index.mjs')
    const projectId = `e2e-storage-${crypto.randomUUID()}`
    const branchId = 'main'
    const sessionId = 'session-1'
    let now = 1_000
    const nextTime = () => ++now
    const createCoordinator = () =>
      new storage.ProjectPersistenceCoordinator({
        backend: new storage.IndexedDbDashboardStorageBackend({ indexedDB, crypto }),
        crypto,
      })
    const projectSchema = (title: string) => ({
      version: '1.0.0',
      componentsTree: [
        {
          componentName: 'Root',
          docId: 'page-home',
          fileName: 'home',
          isRoot: true,
          props: { title },
        },
      ],
    })
    const activeDocument = { documentId: 'page-home', fileName: 'home', index: 0 }
    const commit = (
      coordinator: ReturnType<typeof createCoordinator>,
      value: {
        batchId: string
        expectedDraftGeneration: number
        title: string
      },
    ) =>
      coordinator.commit({
        schemaVersion: 1,
        batchId: value.batchId,
        projectId,
        branchId,
        expectedDraftGeneration: value.expectedDraftGeneration,
        activeDocument,
        projectSchema: projectSchema(value.title),
        commitKind: 'manual-save',
        updatedAt: nextTime(),
        operations: [],
      })

    const first = createCoordinator()
    const second = createCoordinator()
    const restarted = createCoordinator()
    try {
      const initial = await commit(first, {
        batchId: 'project-initial',
        expectedDraftGeneration: 0,
        title: 'initial',
      })
      const writers = await Promise.allSettled([
        commit(first, { batchId: 'project-writer-a', expectedDraftGeneration: 1, title: 'writer-a' }),
        commit(second, { batchId: 'project-writer-b', expectedDraftGeneration: 1, title: 'writer-b' }),
      ])
      const committedWriters = writers.filter(entry => entry.status === 'fulfilled')
      const rejectedWriters = writers.filter(entry => entry.status === 'rejected')
      const latest = await restarted.readWorkingDraft({ projectId, branchId })

      const persistenceBatch = {
        schemaVersion: 1 as const,
        projectId,
        branchId,
        sessionId,
        batchId: 'agent-checkpoint-1',
        expectedPersistenceGeneration: 0,
        records: [
          {
            recordId: 'task:task-1',
            kind: 'agent-runtime-task',
            value: { taskId: 'task-1', phase: 'PAUSED', updatedAt: 2 },
          },
        ],
      }
      const agentCommit = await first.commitAgentPersistence(persistenceBatch)
      await first.flush()
      const agentReplay = await restarted.commitAgentPersistence(structuredClone(persistenceBatch))
      const agentReuse = await restarted.commitAgentPersistence({
        ...persistenceBatch,
        records: [
          {
            recordId: 'task:task-1',
            kind: 'agent-runtime-task',
            value: { taskId: 'task-1', phase: 'COMPLETED', updatedAt: 3 },
          },
        ],
      })
      const agentRead = await restarted.readAgentPersistence({
        schemaVersion: 1,
        projectId,
        branchId,
        sessionId,
        expectedPersistenceGeneration: 0,
      })

      const receiptIntent = {
        schemaVersion: 1 as const,
        projectId,
        branchId,
        callId: 'call-1',
        preparedHash: `sha256:${'a'.repeat(64)}` as const,
        baseRevision: 'revision-1',
        preImages: { title: 'initial' },
        expectedPostImages: { title: 'updated' },
        status: 'pending' as const,
      }
      await restarted.recordReceiptIntent(receiptIntent)
      await restarted.recordReceiptIntent(structuredClone(receiptIntent))
      const lineage = await restarted.readReceiptLineage({ projectId, branchId, callId: 'call-1' })

      return {
        initialGeneration: initial.draftGeneration,
        committedWriterCount: committedWriters.length,
        rejectedWriterCount: rejectedWriters.length,
        rejectedWriterCode:
          rejectedWriters[0]?.status === 'rejected' &&
          typeof rejectedWriters[0].reason === 'object' &&
          rejectedWriters[0].reason !== null &&
          'code' in rejectedWriters[0].reason
            ? rejectedWriters[0].reason.code
            : null,
        latestGeneration: latest?.draftGeneration ?? null,
        latestTitle:
          latest && Array.isArray(latest.projectSchema.componentsTree)
            ? latest.projectSchema.componentsTree[0]?.props?.title
            : null,
        agentCommit,
        agentReplay,
        agentReuse,
        agentRead,
        lineage,
      }
    } finally {
      await Promise.allSettled([first.dispose(), second.dispose(), restarted.dispose()])
    }
  })

  expect(result.initialGeneration).toBe(1)
  expect(result.committedWriterCount).toBe(1)
  expect(result.rejectedWriterCount).toBe(1)
  expect(result.rejectedWriterCode).toBe('generation-conflict')
  expect(result.latestGeneration).toBe(2)
  expect(['writer-a', 'writer-b']).toContain(result.latestTitle)
  expect(result.agentCommit).toEqual({
    schemaVersion: 1,
    batchId: 'agent-checkpoint-1',
    status: 'committed',
    persistenceGeneration: 1,
  })
  expect(result.agentReplay).toEqual(result.agentCommit)
  expect(result.agentReuse).toMatchObject({
    batchId: 'agent-checkpoint-1',
    status: 'rejected',
    persistenceGeneration: 1,
    failure: { code: 'persistence-batch-id-reused', retryable: false },
  })
  expect(result.agentRead).toMatchObject({
    projectId: expect.any(String),
    branchId: 'main',
    sessionId: 'session-1',
    persistenceGeneration: 1,
    records: [{ recordId: 'task:task-1', kind: 'agent-runtime-task' }],
  })
  expect(result.lineage).toMatchObject({
    branchId: 'main',
    callId: 'call-1',
    receiptIntent: { status: 'pending' },
    receipt: null,
    applyWitness: null,
    failureWitness: null,
    provenance: [],
  })
})

test('Memory and real IndexedDB share the durable Agent contract across an abrupt page restart', async ({
  context,
  page,
}) => {
  await page.goto('/')

  const prepared = await page.evaluate(async () => {
    const storage = await import('/src/lib/storage/index.mjs')
    const durable = await import('/src/editor/agent/persistence/durable-agent-commit.mjs')
    const persistencePort = await import('/src/editor/agent/persistence/agent-persistence-port.mjs')
    const provenanceHelpers = await import('/src/editor/agent/persistence/provenance.mjs')
    const receiptHelpers = await import('/src/editor/agent/persistence/receipt-ledger.mjs')

    type Backend =
      | InstanceType<typeof storage.MemoryDashboardStorageBackend>
      | InstanceType<typeof storage.IndexedDbDashboardStorageBackend>

    const runId = crypto.randomUUID()
    const branchId = 'main'
    const sessionId = 'session-browser-contract'
    const activeDocument = { documentId: 'page-home', fileName: 'home', index: 0 }
    const projectSchema = {
      version: '1.0.0',
      componentsTree: [
        {
          componentName: 'Root',
          docId: 'page-home',
          fileName: 'home',
          isRoot: true,
          props: { title: 'durable' },
        },
      ],
    }
    const sha = (character: string) => `sha256:${character.repeat(64)}` as const

    const runAppliedContract = async (backend: Backend, projectId: string) => {
      const coordinator = new storage.ProjectPersistenceCoordinator({ backend, crypto })
      const callId = 'call-applied'
      const authority = { projectId, branchId, callId }
      const intent = receiptHelpers.createReceiptIntent({
        schemaVersion: 1,
        ...authority,
        preparedHash: sha('a'),
        baseRevision: 'core:1:registry:1',
        preImages: [{ slotKey: 'title', value: 'before' }],
        expectedPostImages: [{ slotKey: 'title', value: 'durable' }],
        status: 'pending',
      })
      const slotKeys = provenanceHelpers.createFieldSlotAliases({
        projectId,
        branchId,
        nodeId: 'title-1',
        root: 'props',
        path: ['text'],
      })
      const provenance = provenanceHelpers.createMutationProvenanceBatch({
        projectId,
        branchId,
        draftGeneration: 1,
        slotKeys,
        source: 'agent',
        callId,
      })
      const witness = receiptHelpers.createApplyWitness({
        schemaVersion: 1,
        ...authority,
        draftGeneration: 1,
        coreMutationVersion: 2,
        transactionFingerprint: sha('b'),
        affectedSlotTokens: provenance.map(({ slotKey, token }) => ({ slotKey, token })),
      })
      const receipt = receiptHelpers.createToolReceipt({
        schemaVersion: 1,
        ...authority,
        status: 'applied',
        revision: 'core:2:registry:1',
        witness: receiptHelpers.createToolReceiptWitness(witness),
      })
      await durable.recordDurableAgentIntent({ coordinator, intent })
      const committed = await durable.commitDurableAgentBatch({
        coordinator,
        batch: {
          schemaVersion: 1,
          ...authority,
          expectedDraftGeneration: 0,
          activeDocument,
          projectSchema,
          updatedAt: 1_000,
          receiptIntent: intent,
          receipt,
          witness,
          provenance,
          sessionId,
          journal: {
            recordId: 'journal:call-applied',
            kind: 'verified-step',
            value: { taskId: 'task-browser', phase: 'VERIFY' },
          },
          checkpoint: {
            checkpointId: 'checkpoint:call-applied',
            value: { taskId: 'task-browser', verified: true },
          },
          artifactRefs: [
            {
              ownerType: 'checkpoint',
              ownerId: 'checkpoint:call-applied',
              artifactId: 'artifact-browser',
              sourceRevision: 'revision-1',
            },
          ],
        },
      })

      const port = persistencePort.createDashboardAgentPersistencePort(coordinator)
      const sessionCommit = await port.commit({
        schemaVersion: 1,
        projectId,
        branchId,
        sessionId,
        batchId: 'session-batch-1',
        expectedPersistenceGeneration: 0,
        records: [
          {
            recordId: 'task:task-browser',
            kind: 'agent-runtime-task',
            value: {
              taskId: 'task-browser',
              sessionId,
              phase: 'PAUSED',
              createdAt: 1,
              updatedAt: 2,
              repairAttempts: 0,
              intent: { text: 'persist in the browser' },
            },
          },
        ],
      })

      const collisionProvenance = provenanceHelpers.createMutationProvenanceBatch({
        projectId,
        branchId,
        draftGeneration: 2,
        slotKeys,
        source: 'agent',
        callId,
      })
      const collisionWitness = receiptHelpers.createApplyWitness({
        schemaVersion: 1,
        ...authority,
        draftGeneration: 2,
        coreMutationVersion: 3,
        transactionFingerprint: sha('c'),
        affectedSlotTokens: collisionProvenance.map(({ slotKey, token }) => ({ slotKey, token })),
      })
      const collisionReceipt = receiptHelpers.createToolReceipt({
        schemaVersion: 1,
        ...authority,
        status: 'applied',
        revision: 'core:3:registry:1',
        witness: receiptHelpers.createToolReceiptWitness(collisionWitness),
      })
      let collisionCode: string | null = null
      try {
        await durable.commitDurableAgentBatch({
          coordinator,
          batch: {
            schemaVersion: 1,
            ...authority,
            expectedDraftGeneration: 1,
            activeDocument,
            projectSchema: { ...projectSchema, version: '2.0.0' },
            updatedAt: 2_000,
            receiptIntent: intent,
            receipt: collisionReceipt,
            witness: collisionWitness,
            provenance: collisionProvenance,
            sessionId,
            journal: {
              recordId: 'journal:call-applied-duplicate',
              kind: 'verified-step',
              value: { taskId: 'task-browser', phase: 'VERIFY' },
            },
            checkpoint: {
              checkpointId: 'checkpoint:call-applied-duplicate',
              value: { taskId: 'task-browser', verified: true },
            },
          },
        })
      } catch (error) {
        collisionCode =
          typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string'
            ? error.code
            : 'unknown'
      }

      const [draft, lineage, recovery, sessionRead, journal, checkpoint, artifactRef] = await Promise.all([
        coordinator.readWorkingDraft({ projectId, branchId }),
        coordinator.readReceiptLineage(authority),
        durable.recoverDurableAgentReceipt({ coordinator, ...authority }),
        port.read({
          schemaVersion: 1,
          projectId,
          branchId,
          sessionId,
          expectedPersistenceGeneration: 1,
        }),
        backend.get('taskJournals', [projectId, branchId, sessionId, 'journal:call-applied']),
        backend.get('agentCheckpoints', [projectId, branchId, 'checkpoint:call-applied']),
        backend.get('artifactRefs', [
          projectId,
          branchId,
          'checkpoint',
          'checkpoint:call-applied',
          'artifact-browser',
          'revision-1',
        ]),
      ])
      return {
        projectId,
        branchId,
        sessionId,
        callId,
        committedGeneration: committed.draft.draftGeneration,
        collisionCode,
        finalGeneration: draft?.draftGeneration ?? null,
        recoveryClassification: recovery.classification,
        receiptStatus: lineage.receipt?.status ?? null,
        applyWitnessGeneration: lineage.applyWitness?.draftGeneration ?? null,
        failureWitness: lineage.failureWitness,
        provenanceCount: lineage.provenance.length,
        journalKind: journal?.kind ?? null,
        checkpointOutcome: checkpoint?.outcome ?? null,
        artifactCallId: artifactRef?.callId ?? null,
        sessionCommit,
        sessionGeneration: sessionRead.persistenceGeneration,
        sessionRecordIds: sessionRead.records.map(record => record.recordId),
      }
    }

    const runFailedContract = async (backend: Backend, projectId: string) => {
      const coordinator = new storage.ProjectPersistenceCoordinator({ backend, crypto })
      const callId = 'call-failed'
      const authority = { projectId, branchId, callId }
      const intent = receiptHelpers.createReceiptIntent({
        schemaVersion: 1,
        ...authority,
        preparedHash: sha('d'),
        baseRevision: 'core:1:registry:1',
        preImages: [{ slotKey: 'title', value: 'before' }],
        expectedPostImages: [{ slotKey: 'title', value: 'after' }],
        status: 'pending',
      })
      const witness = receiptHelpers.createFailureWitness({
        schemaVersion: 1,
        ...authority,
        draftGeneration: 1,
        transactionFingerprint: sha('e'),
        receiptStatus: 'not-applied',
        failureCode: 'VALIDATION_FAILED',
      })
      const receipt = receiptHelpers.createToolReceipt({
        schemaVersion: 1,
        ...authority,
        status: 'not-applied',
        revision: 'core:1:registry:1',
        witness: receiptHelpers.createToolReceiptWitness(witness),
        failure: { code: 'VALIDATION_FAILED', message: 'validation failed', retryable: false },
      })
      await durable.recordDurableAgentIntent({ coordinator, intent })
      const committed = await durable.commitDurableAgentBatch({
        coordinator,
        batch: {
          schemaVersion: 1,
          ...authority,
          expectedDraftGeneration: 0,
          activeDocument,
          projectSchema,
          updatedAt: 3_000,
          receiptIntent: intent,
          receipt,
          witness,
          provenance: [],
          sessionId,
          journal: {
            recordId: 'journal:call-failed',
            kind: 'failed-step',
            value: { taskId: 'task-failed', phase: 'PAUSED' },
          },
          checkpoint: {
            checkpointId: 'checkpoint:call-failed',
            value: { taskId: 'task-failed', verified: false },
          },
        },
      })
      const [lineage, recovery, journal, checkpoint] = await Promise.all([
        coordinator.readReceiptLineage(authority),
        durable.recoverDurableAgentReceipt({ coordinator, ...authority }),
        backend.get('taskJournals', [projectId, branchId, sessionId, 'journal:call-failed']),
        backend.get('agentCheckpoints', [projectId, branchId, 'checkpoint:call-failed']),
      ])
      return {
        projectId,
        branchId,
        callId,
        committedGeneration: committed.draft.draftGeneration,
        recoveryClassification: recovery.classification,
        receiptStatus: lineage.receipt?.status ?? null,
        applyWitness: lineage.applyWitness,
        failureWitnessGeneration: lineage.failureWitness?.draftGeneration ?? null,
        provenanceCount: lineage.provenance.length,
        journalKind: journal?.kind ?? null,
        checkpointOutcome: checkpoint?.outcome ?? null,
      }
    }

    const memoryApplied = await runAppliedContract(
      new storage.MemoryDashboardStorageBackend({ crypto }),
      `e2e-contract-memory-applied-${runId}`,
    )
    const indexedDbApplied = await runAppliedContract(
      new storage.IndexedDbDashboardStorageBackend({ indexedDB, crypto }),
      `e2e-contract-indexeddb-applied-${runId}`,
    )
    const memoryFailed = await runFailedContract(
      new storage.MemoryDashboardStorageBackend({ crypto }),
      `e2e-contract-memory-failed-${runId}`,
    )
    const indexedDbFailed = await runFailedContract(
      new storage.IndexedDbDashboardStorageBackend({ indexedDB, crypto }),
      `e2e-contract-indexeddb-failed-${runId}`,
    )

    const withoutAuthority = <T extends { projectId: string }>(value: T) => {
      const { projectId: _projectId, ...contract } = value
      return contract
    }
    return {
      memoryApplied: withoutAuthority(memoryApplied),
      indexedDbApplied: withoutAuthority(indexedDbApplied),
      memoryFailed: withoutAuthority(memoryFailed),
      indexedDbFailed: withoutAuthority(indexedDbFailed),
      restart: {
        applied: {
          projectId: indexedDbApplied.projectId,
          branchId,
          sessionId,
          callId: indexedDbApplied.callId,
        },
        failed: {
          projectId: indexedDbFailed.projectId,
          branchId,
          callId: indexedDbFailed.callId,
        },
      },
    }
  })

  expect(prepared.indexedDbApplied).toEqual(prepared.memoryApplied)
  expect(prepared.indexedDbFailed).toEqual(prepared.memoryFailed)
  expect(prepared.indexedDbApplied).toMatchObject({
    committedGeneration: 1,
    collisionCode: 'transaction-aborted',
    finalGeneration: 1,
    recoveryClassification: 'committed',
    receiptStatus: 'applied',
    applyWitnessGeneration: 1,
    failureWitness: null,
    journalKind: 'verified-step',
    checkpointOutcome: 'committed',
    artifactCallId: 'call-applied',
    sessionCommit: {
      status: 'committed',
      persistenceGeneration: 1,
    },
    sessionGeneration: 1,
    sessionRecordIds: ['journal:call-applied', 'task:task-browser'],
  })
  expect(prepared.indexedDbApplied.provenanceCount).toBeGreaterThan(0)
  expect(prepared.indexedDbFailed).toMatchObject({
    committedGeneration: 1,
    recoveryClassification: 'failed',
    receiptStatus: 'not-applied',
    applyWitness: null,
    failureWitnessGeneration: 1,
    provenanceCount: 0,
    journalKind: 'failed-step',
    checkpointOutcome: 'failed',
  })

  await page.close()
  const reopened = await context.newPage()
  await reopened.goto('/')
  const afterRestart = await reopened.evaluate(async restart => {
    const storage = await import('/src/lib/storage/index.mjs')
    const durable = await import('/src/editor/agent/persistence/durable-agent-commit.mjs')
    const persistencePort = await import('/src/editor/agent/persistence/agent-persistence-port.mjs')
    const coordinator = new storage.ProjectPersistenceCoordinator({
      backend: new storage.IndexedDbDashboardStorageBackend({ indexedDB, crypto }),
      crypto,
    })
    try {
      const port = persistencePort.createDashboardAgentPersistencePort(coordinator)
      const [applied, failed, session] = await Promise.all([
        durable.recoverDurableAgentReceipt({
          coordinator,
          projectId: restart.applied.projectId,
          branchId: restart.applied.branchId,
          callId: restart.applied.callId,
        }),
        durable.recoverDurableAgentReceipt({ coordinator, ...restart.failed }),
        port.read({
          schemaVersion: 1,
          projectId: restart.applied.projectId,
          branchId: restart.applied.branchId,
          sessionId: restart.applied.sessionId,
          expectedPersistenceGeneration: 1,
        }),
      ])
      return {
        appliedClassification: applied.classification,
        appliedStatus: applied.receipt?.status ?? null,
        failedClassification: failed.classification,
        failedStatus: failed.receipt?.status ?? null,
        sessionGeneration: session.persistenceGeneration,
        sessionRecordIds: session.records.map(record => record.recordId),
      }
    } finally {
      await coordinator.dispose()
    }
  }, prepared.restart)

  expect(afterRestart).toEqual({
    appliedClassification: 'committed',
    appliedStatus: 'applied',
    failedClassification: 'failed',
    failedStatus: 'not-applied',
    sessionGeneration: 1,
    sessionRecordIds: ['journal:call-applied', 'task:task-browser'],
  })
})
