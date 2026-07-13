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
      extraKeys: [],
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
