import assert from 'node:assert/strict'
import test from 'node:test'
import { MessageChannel, Worker } from 'node:worker_threads'
import { createProjectSchema } from './fixtures/project-schema.mjs'
import { captureFailure, loadCore } from './helpers/kernel.mjs'

async function createReadyEngine(t) {
  const core = await loadCore()
  const engine = core.createEngine({ hostWindow: null, trustPolicy: 'legacyTrusted' })
  t.after(() => engine.destroy())
  await engine.init()
  engine.project.load(createProjectSchema(), true)
  return { core, document: engine.project.currentDocument, engine }
}

function grantFor(document) {
  return {
    subjectId: 'agent:worker-channel',
    documentIds: [document.id],
    commandTypes: ['updateProps'],
    componentProps: { Page: { title: { type: 'string', maxBytes: 16 * 1024 } } },
  }
}

const nextTurn = () => new Promise(resolve => setImmediate(resolve))

const waitUntil = async (predicate, message) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error(message)
}

const createFakeDescriptor = () => ({
  protocol: 1,
  transport: 'message-port',
  isolation: 'structured-clone-object-capability',
  capability: {
    capabilityId: 'fake-capability',
    subjectId: 'agent:unknown-outcome',
    assurance: 'policy-restricted-co-realm',
    grant: {
      documentIds: ['doc'],
      commandTypes: ['updateProps'],
      componentNames: [],
      componentProps: { Page: { title: { type: 'string', maxBytes: 16 * 1024 } } },
      extraKeys: [],
      extraValues: {},
      limits: {
        maxCommands: 1,
        maxInsertedNodes: 1,
        maxPayloadBytes: 1024,
        maxSnapshotBytes: 1024,
        maxTreeDepth: 8,
      },
    },
  },
})

test('MessagePort capability performs snapshot, preview and execute without exposing model objects', async t => {
  const { core, document, engine } = await createReadyEngine(t)
  const { port1, port2 } = new MessageChannel()
  const controller = new AbortController()
  t.after(() => controller.abort())

  const session = engine.agentCapabilities.issuePort(grantFor(document), port1, { signal: controller.signal })
  const capability = await core.connectAgentPort(port2)
  const events = []
  const unsubscribe = capability.subscribe(event => events.push(event))
  t.after(unsubscribe)

  assert.equal(session.descriptor.protocol, 1)
  assert.equal(session.descriptor.transport, 'message-port')
  assert.equal(session.descriptor.isolation, 'structured-clone-object-capability')
  assert.equal(session.descriptor.executionAuthority, 'peer')
  assert.deepEqual(capability.descriptor, session.descriptor)

  const snapshot = await capability.snapshot(document.id)
  assert.deepEqual(snapshot.schema, document.export())
  assert.notStrictEqual(snapshot.schema, document.export())
  const deniedSnapshot = await captureFailure(() => capability.snapshot('ungranted-document'))
  assert.equal(deniedSnapshot.code, 'agent.grant.documentDenied')

  const preview = await capability.preview({
    documentId: document.id,
    baseRevision: snapshot.revision,
    commands: [{ type: 'updateProps', nodeId: document.root.id, props: { title: 'from-worker-port' } }],
  })
  const receipt = await capability.execute(preview.planId)

  assert.equal(receipt.status, 'committed')
  assert.equal(document.root.getPropValue('title'), 'from-worker-port')
  assert.equal(events.length, 0, 'the committed event must not overtake the execute response')
  await nextTurn()
  assert.equal(events.length, 1)
  assert.equal(events[0].type, 'agent.transaction.committed')
  assert.equal(events[0].documentId, document.id)
  assert.equal(events[0].planId, preview.planId)
  assert.equal(Object.isFrozen(events[0]), true)
  assert.deepEqual(events[0].affectedNodeIds, [document.root.id])
  assert.equal(Object.hasOwn(events[0], 'document'), false)
  assert.equal(Object.hasOwn(events[0], 'engine'), false)

  capability.close()
  await nextTurn()
  assert.equal(session.state, 'closed')
  const closed = await captureFailure(() => capability.snapshot(document.id))
  assert.equal(closed.code, 'agent.transport.closed')
})

test('host execution authority lets the peer prepare a plan but only the host session can execute it', async t => {
  const { core, document, engine } = await createReadyEngine(t)
  const { port1, port2 } = new MessageChannel()
  const controller = new AbortController()
  t.after(() => controller.abort())

  const session = engine.agentCapabilities.issuePort(grantFor(document), port1, {
    executionAuthority: 'host',
    signal: controller.signal,
  })
  const capability = await core.connectAgentPort(port2)

  assert.equal(session.descriptor.executionAuthority, 'host')
  assert.equal(capability.descriptor.executionAuthority, 'host')

  const snapshot = await capability.snapshot(document.id)
  const preview = await capability.preview({
    documentId: document.id,
    baseRevision: snapshot.revision,
    commands: [{ type: 'updateProps', nodeId: document.root.id, props: { title: 'host-approved' } }],
  })

  const denied = await captureFailure(() => capability.execute(preview.planId))
  assert.equal(denied.code, 'agent.execution.hostApprovalRequired')
  assert.equal(denied.action, 'execute')
  assert.equal(denied.committed, false)
  assert.equal(denied.terminal, false)
  assert.equal(session.state, 'open')
  assert.notEqual(document.root.getPropValue('title'), 'host-approved')

  const receipt = session.approveAndExecute(preview.planId)
  assert.equal(receipt.status, 'committed')
  assert.equal(document.root.getPropValue('title'), 'host-approved')

  const replay = await captureFailure(() => session.approveAndExecute(preview.planId))
  assert.equal(replay.code, 'agent.plan.terminal')

  session.close()
  const closed = await captureFailure(() => session.approveAndExecute(preview.planId))
  assert.equal(closed.code, 'agent.transport.closed')
})

test('the host session exposes only the authoritative current prepared plan preview', async t => {
  const { core, document, engine } = await createReadyEngine(t)
  const { port1, port2 } = new MessageChannel()
  const controller = new AbortController()
  t.after(() => controller.abort())
  const session = engine.agentCapabilities.issuePort(grantFor(document), port1, {
    executionAuthority: 'host',
    signal: controller.signal,
  })
  const capability = await core.connectAgentPort(port2)

  const unknown = await captureFailure(() => session.getPreparedPlanPreview('unknown-plan'))
  assert.equal(unknown.code, 'agent.plan.notFound')

  const snapshot = await capability.snapshot(document.id)
  const first = await capability.preview({
    documentId: document.id,
    baseRevision: snapshot.revision,
    commands: [{ type: 'updateProps', nodeId: document.root.id, props: { title: 'first-preview' } }],
  })
  const authoritativeFirst = session.getPreparedPlanPreview(first.planId)
  assert.notStrictEqual(authoritativeFirst, first)
  assert.deepEqual(authoritativeFirst, first)
  assert.equal(Object.isFrozen(authoritativeFirst), true)
  assert.equal(Object.isFrozen(authoritativeFirst.effects), true)
  assert.equal(Object.isFrozen(authoritativeFirst.effects[0]), true)

  const second = await capability.preview({
    documentId: document.id,
    baseRevision: snapshot.revision,
    commands: [{ type: 'updateProps', nodeId: document.root.id, props: { title: 'second-preview' } }],
  })
  const superseded = await captureFailure(() => session.getPreparedPlanPreview(first.planId))
  assert.equal(superseded.code, 'agent.plan.terminal')
  assert.deepEqual(session.getPreparedPlanPreview(second.planId), second)

  session.approveAndExecute(second.planId)
  const terminal = await captureFailure(() => session.getPreparedPlanPreview(second.planId))
  assert.equal(terminal.code, 'agent.plan.terminal')

  const postCommitSnapshot = await capability.snapshot(document.id)
  const third = await capability.preview({
    documentId: document.id,
    baseRevision: postCommitSnapshot.revision,
    commands: [{ type: 'updateProps', nodeId: document.root.id, props: { title: 'third-preview' } }],
  })
  assert.deepEqual(session.getPreparedPlanPreview(third.planId), third)

  session.close()
  const closed = await captureFailure(() => session.getPreparedPlanPreview(third.planId))
  assert.equal(closed.code, 'agent.transport.closed')
})

test('host execution authority rejects a handcrafted peer execute request at the host boundary', async t => {
  const { document, engine } = await createReadyEngine(t)
  const { port1, port2 } = new MessageChannel()
  const controller = new AbortController()
  t.after(() => {
    controller.abort()
    port1.close()
    port2.close()
  })
  const session = engine.agentCapabilities.issuePort(grantFor(document), port1, {
    executionAuthority: 'host',
    signal: controller.signal,
  })
  const receive = () => new Promise(resolve => port2.once('message', resolve))
  const ready = await receive()

  port2.postMessage({
    version: 1,
    kind: 'request',
    sessionId: ready.sessionId,
    sequence: 1,
    operation: 'snapshot',
    payload: { documentId: document.id },
  })
  const snapshotResponse = await receive()
  assert.equal(snapshotResponse.ok, true)

  port2.postMessage({
    version: 1,
    kind: 'request',
    sessionId: ready.sessionId,
    sequence: 2,
    operation: 'preview',
    payload: {
      documentId: document.id,
      baseRevision: snapshotResponse.result.revision,
      commands: [{ type: 'updateProps', nodeId: document.root.id, props: { title: 'raw-peer-denied' } }],
    },
  })
  const previewResponse = await receive()
  assert.equal(previewResponse.ok, true)

  port2.postMessage({
    version: 1,
    kind: 'request',
    sessionId: ready.sessionId,
    sequence: 3,
    operation: 'execute',
    payload: { planId: previewResponse.result.planId },
  })
  const executeResponse = await receive()

  assert.equal(executeResponse.ok, false)
  assert.equal(executeResponse.error.code, 'agent.execution.hostApprovalRequired')
  assert.equal(executeResponse.error.committed, false)
  assert.notEqual(document.root.getPropValue('title'), 'raw-peer-denied')

  const deniedAudit = engine.agentCapabilities
    .getAuditRecords()
    .find(record => record.action === 'execute' && record.planId === previewResponse.result.planId)
  assert.equal(deniedAudit?.decision, 'denied')
  assert.equal(deniedAudit?.outcome, 'rejected')
  assert.equal(deniedAudit?.error?.code, 'agent.execution.hostApprovalRequired')

  const receipt = session.approveAndExecute(previewResponse.result.planId)
  assert.equal(receipt.status, 'committed')
  assert.equal(document.root.getPropValue('title'), 'raw-peer-denied')
})

test('host domain events are immutable, asynchronous and emitted only for committed executions', async t => {
  const { document, engine } = await createReadyEngine(t)
  const capability = engine.agentCapabilities.issue(grantFor(document))
  const events = []
  const dispose = engine.agentCapabilities.subscribeDomainEvents(event => events.push(event))
  t.after(dispose)

  const snapshot = capability.snapshot(document.id)
  const preview = capability.preview({
    documentId: document.id,
    baseRevision: snapshot.revision,
    commands: [{ type: 'updateProps', nodeId: document.root.id, props: { title: 'domain-event' } }],
  })
  const receipt = capability.execute(preview.planId)

  assert.equal(receipt.status, 'committed')
  assert.equal(events.length, 0)
  await Promise.resolve()
  assert.equal(events.length, 1)
  assert.equal(Object.isFrozen(events[0]), true)
  assert.equal(Object.isFrozen(events[0].affectedNodeIds), true)

  assert.throws(() => capability.execute('missing-plan'))
  await Promise.resolve()
  assert.equal(events.length, 1, 'rejected executions must not publish committed domain events')
})

test('invalid protocol sequence fails closed and revokes the bearer capability', async t => {
  const { document, engine } = await createReadyEngine(t)
  const { port1, port2 } = new MessageChannel()
  const controller = new AbortController()
  t.after(() => controller.abort())
  const session = engine.agentCapabilities.issuePort(grantFor(document), port1, { signal: controller.signal })
  const ready = await new Promise(resolve => {
    port2.onmessage = event => resolve(event.data)
    port2.start()
  })
  assert.equal(ready.kind, 'ready')

  const closed = new Promise(resolve => {
    port2.onmessage = event => {
      if (event.data.kind === 'closed') resolve(event.data)
    }
  })
  port2.postMessage({
    version: 1,
    kind: 'request',
    sessionId: ready.sessionId,
    sequence: 2,
    operation: 'snapshot',
    payload: { documentId: document.id },
  })

  const message = await closed
  assert.equal(message.reason, 'agent.transport.protocol')
  await nextTurn()
  assert.equal(session.state, 'closed')
})

test('a real Worker uses only the structured-clone capability channel', async t => {
  const { document, engine } = await createReadyEngine(t)
  const worker = new Worker(new URL('./fixtures/agent-channel-worker.mjs', import.meta.url))
  const { port1, port2 } = new MessageChannel()
  const controller = new AbortController()
  const session = engine.agentCapabilities.issuePort(grantFor(document), port1, { signal: controller.signal })
  t.after(async () => {
    controller.abort()
    await worker.terminate()
  })

  const messages = []
  const completed = new Promise((resolve, reject) => {
    worker.on('message', message => {
      messages.push(message)
      if (message.kind === 'error') reject(new Error(`${message.error.name}: ${message.error.message}`))
      if (messages.some(item => item.kind === 'receipt') && messages.some(item => item.kind === 'event')) resolve()
    })
    worker.on('error', reject)
  })
  worker.postMessage({ documentId: document.id, port: port2 }, [port2])
  await completed

  const result = messages.find(message => message.kind === 'receipt')
  const event = messages.find(message => message.kind === 'event').event
  assert.equal(result.receipt.status, 'committed')
  assert.equal(document.root.getPropValue('title'), 'from-real-worker')
  assert.equal(result.descriptor.isolation, 'structured-clone-object-capability')
  assert.equal(Object.hasOwn(result.snapshot, 'document'), false)
  assert.equal(Object.hasOwn(result.snapshot, 'engine'), false)
  assert.equal(event.planId, result.receipt.planId)

  controller.abort()
  await nextTurn()
  assert.equal(session.state, 'closed')
})

test('engine disposal closes MessagePort sessions and rejects later client operations', async t => {
  const { core, document, engine } = await createReadyEngine(t)
  const { port1, port2 } = new MessageChannel()
  const controller = new AbortController()
  const session = engine.agentCapabilities.issuePort(grantFor(document), port1, { signal: controller.signal })
  const capability = await core.connectAgentPort(port2)

  await engine.destroy()
  await nextTurn()
  assert.equal(session.state, 'closed')
  const error = await captureFailure(() => capability.snapshot(document.id))
  assert.equal(error.code, 'agent.transport.closed')
})

test('an abrupt peer close before ready rejects the client handshake instead of hanging', async () => {
  const core = await loadCore()
  const { port1, port2 } = new MessageChannel()
  const connected = core.connectAgentPort(port2, { connectTimeoutMs: 250 })

  port1.close()

  const error = await captureFailure(() => connected)
  assert.equal(error.code, 'agent.transport.closed')
})

test('the client handshake has a bounded timeout when the runtime exposes no close event', async () => {
  const core = await loadCore()
  let closeCount = 0
  const silentPort = {
    onmessage: null,
    onmessageerror: null,
    postMessage() {},
    start() {},
    close() {
      closeCount += 1
    },
  }

  const error = await captureFailure(() => core.connectAgentPort(silentPort, { connectTimeoutMs: 10 }))

  assert.equal(error.code, 'agent.transport.connectTimeout')
  assert.equal(closeCount, 1)
  assert.equal(silentPort.onmessage, null)
  assert.equal(silentPort.onmessageerror, null)
})

test('the client rejects an unsupported execution authority in the host descriptor', async t => {
  const core = await loadCore()
  const { port1, port2 } = new MessageChannel()
  t.after(() => {
    port1.close()
    port2.close()
  })
  port1.postMessage({
    version: 1,
    kind: 'ready',
    sessionId: 'fake-session',
    descriptor: { ...createFakeDescriptor(), executionAuthority: 'owner' },
  })

  const error = await captureFailure(() => core.connectAgentPort(port2))
  assert.equal(error.code, 'agent.transport.closed')
})

test('issuing a MessagePort capability rejects an unsupported execution authority before creating a session', async t => {
  const { document, engine } = await createReadyEngine(t)
  const { port1, port2 } = new MessageChannel()
  const controller = new AbortController()
  t.after(() => {
    controller.abort()
    port1.close()
    port2.close()
  })

  const error = await captureFailure(() =>
    engine.agentCapabilities.issuePort(grantFor(document), port1, {
      executionAuthority: 'owner',
      signal: controller.signal,
    }),
  )

  assert.equal(error.code, 'agent.transport.invalidOptions')
})

test('an abrupt peer close during execute reports outcome unknown', async () => {
  const core = await loadCore()
  const { port1, port2 } = new MessageChannel()
  port1.on('message', message => {
    if (message.kind === 'request' && message.operation === 'execute') port1.close()
  })
  port1.postMessage({ version: 1, kind: 'ready', sessionId: 'fake-session', descriptor: createFakeDescriptor() })

  const capability = await core.connectAgentPort(port2, { requestTimeoutMs: 250 })
  const error = await captureFailure(() => capability.execute('possibly-committed-plan'))

  assert.equal(error.name, 'AgentTransportOutcomeUnknownError')
  assert.equal(error.code, 'agent.transport.outcomeUnknown')
  assert.equal(error.committed, 'unknown')
  assert.equal(error.operation, 'execute')
})

test('a lost host-authority execute denial remains known not committed', async t => {
  const core = await loadCore()
  const { port1, port2 } = new MessageChannel()
  t.after(() => {
    port1.close()
    port2.close()
  })
  port1.on('message', message => {
    if (message.kind === 'request' && message.operation === 'execute') port1.close()
  })
  port1.postMessage({
    version: 1,
    kind: 'ready',
    sessionId: 'fake-session',
    descriptor: { ...createFakeDescriptor(), executionAuthority: 'host' },
  })

  const capability = await core.connectAgentPort(port2, { requestTimeoutMs: 250 })
  const error = await captureFailure(() => capability.execute('host-controlled-plan'))

  assert.equal(error.name, 'AgentCapabilityError')
  assert.equal(error.code, 'agent.execution.hostApprovalRequired')
  assert.equal(error.committed, false)
  assert.equal(error.action, 'execute')
})

test('an abrupt client peer close terminates the host session and revokes its capability', async t => {
  const { core, document, engine } = await createReadyEngine(t)
  const { port1, port2 } = new MessageChannel()
  const controller = new AbortController()
  t.after(() => controller.abort())
  const session = engine.agentCapabilities.issuePort(grantFor(document), port1, { signal: controller.signal })
  const capability = await core.connectAgentPort(port2)

  port2.close()
  await waitUntil(() => session.state === 'closed', 'host session did not observe the closed peer')

  const revokeRecords = engine.agentCapabilities
    .getAuditRecords()
    .filter(record => record.capabilityId === session.descriptor.capability.capabilityId && record.action === 'revoke')
  assert.equal(revokeRecords.length, 1)
  assert.equal(revokeRecords[0].outcome, 'revoked')
  const error = await captureFailure(() => capability.snapshot(document.id))
  assert.equal(error.code, 'agent.transport.closed')
})

test('a malformed execute response reports outcome unknown instead of committed false', async () => {
  const core = await loadCore()
  const { port1, port2 } = new MessageChannel()
  port1.on('message', message => {
    if (message.kind !== 'request' || message.operation !== 'execute') return
    port1.postMessage({
      version: 1,
      kind: 'response',
      sessionId: 'fake-session',
      sequence: message.sequence,
      ok: false,
    })
  })
  port1.postMessage({ version: 1, kind: 'ready', sessionId: 'fake-session', descriptor: createFakeDescriptor() })

  const capability = await core.connectAgentPort(port2, { requestTimeoutMs: 250 })
  const error = await captureFailure(() => capability.execute('possibly-committed-plan'))

  assert.equal(error.name, 'AgentTransportOutcomeUnknownError')
  assert.equal(error.code, 'agent.transport.outcomeUnknown')
  assert.equal(error.committed, 'unknown')
})

test('a lost execute response is reported as outcome unknown and is never safe to retry', async () => {
  const core = await loadCore()
  const { port1, port2 } = new MessageChannel()
  port1.on('message', message => {
    if (message.kind !== 'request' || message.operation !== 'execute') return
    port1.postMessage({ version: 1, kind: 'closed', sessionId: 'fake-session', reason: 'lost-response' })
    port1.close()
  })
  port1.postMessage({ version: 1, kind: 'ready', sessionId: 'fake-session', descriptor: createFakeDescriptor() })

  const capability = await core.connectAgentPort(port2)
  const error = await captureFailure(() => capability.execute('possibly-committed-plan'))
  assert.equal(error.name, 'AgentTransportOutcomeUnknownError')
  assert.equal(error.code, 'agent.transport.outcomeUnknown')
  assert.equal(error.committed, 'unknown')
  assert.equal(error.operation, 'execute')
})
