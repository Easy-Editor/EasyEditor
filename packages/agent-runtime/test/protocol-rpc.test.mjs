import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after, before } from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { MessageChannel } from 'node:worker_threads'
import ts from 'typescript'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
let emittedRoot
let protocol
let rpc
let runtimeContracts

before(async () => {
  emittedRoot = await mkdtemp(path.join(tmpdir(), 'easy-editor-agent-protocol-'))
  const configPath = path.join(packageRoot, 'tsconfig.build.json')
  const config = ts.readConfigFile(configPath, ts.sys.readFile)
  assert.equal(config.error, undefined)
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, packageRoot)
  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options: {
      ...parsed.options,
      declaration: false,
      declarationMap: false,
      emitDeclarationOnly: false,
      noEmit: false,
      outDir: emittedRoot,
      rootDir: path.join(packageRoot, 'src'),
      sourceMap: false,
    },
  })
  const emit = program.emit()
  const diagnostics = [...ts.getPreEmitDiagnostics(program), ...emit.diagnostics]
  assert.deepEqual(
    diagnostics.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')),
    [],
  )
  assert.equal(emit.emitSkipped, false)

  protocol = await import(pathToFileURL(path.join(emittedRoot, 'internal/protocol/index.js')).href)
  rpc = await import(pathToFileURL(path.join(emittedRoot, 'internal/rpc/index.js')).href)
  runtimeContracts = await import(pathToFileURL(path.join(emittedRoot, 'internal/runtime/contracts.js')).href)
})

after(async () => {
  if (emittedRoot) await rm(emittedRoot, { recursive: true, force: true })
})

const baseContext = { sessionId: 'session-1', taskId: 'task-1', stepId: 'step-1' }

const semanticCall = {
  schemaVersion: 1,
  projectId: 'project-1',
  branchId: 'branch-1',
  sessionId: 'session-1',
  taskId: 'task-1',
  stepId: 'step-1',
  callId: 'call-1',
  capability: 'task.compensate',
  arguments: { schemaVersion: 1, targetTaskId: 'target-task' },
  expectedRevision: 'revision-1',
}

const makeEnvelope = (overrides = {}) => ({
  protocolVersion: 1,
  ...baseContext,
  messageId: 'message-1',
  kind: 'rpc.request',
  sentAt: 100,
  payload: { requestId: 'request-1', operation: 'echo', value: null },
  ...overrides,
})

const createIdFactory = prefix => {
  let sequence = 0
  return {
    next(kind) {
      sequence += 1
      return `${prefix}-${kind}-${sequence}`
    },
  }
}

const createClock = () => {
  let now = 1000
  return { now: () => ++now }
}

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))

test('invocation and receipt contracts bind failure presence to the terminal status', () => {
  const failure = { code: 'NO_CHANGE', message: 'already satisfied', retryable: false }
  assert.deepEqual(rpc.parseInvocationResult({ schemaVersion: 1, callId: 'call-1', status: 'not-applied', failure }), {
    schemaVersion: 1,
    callId: 'call-1',
    status: 'not-applied',
    failure,
  })
  assert.throws(
    () => rpc.parseInvocationResult({ schemaVersion: 1, callId: 'call-1', status: 'applied', failure }),
    protocol.ProtocolValidationError,
  )
  assert.throws(
    () => rpc.parseInvocationResult({ schemaVersion: 1, callId: 'call-1', status: 'not-applied' }),
    protocol.ProtocolValidationError,
  )
  assert.throws(
    () =>
      rpc.parseToolReceipt({
        schemaVersion: 1,
        projectId: 'project-1',
        branchId: 'branch-1',
        callId: 'call-1',
        status: 'applied',
        failure,
      }),
    protocol.ProtocolValidationError,
  )
})

test('Host invoke RPC keeps Runtime-owned context separate and rejects forged structural fields', () => {
  const request = {
    schemaVersion: 1,
    call: semanticCall,
    context: {
      schemaVersion: 1,
      compensationTarget: {
        schemaVersion: 1,
        taskId: 'target-task',
        sessionId: 'session-1',
        phase: 'COMPLETED',
        callIndexComplete: true,
        callIndex: [{ callId: 'target-call-1', capability: 'screen.applyChangeSet' }],
      },
    },
  }
  assert.deepEqual(rpc.agentBoundaryRpcContracts['host.invoke'].parseRequest(request), request)

  for (const invalid of [
    { call: request.call, context: request.context },
    { ...request, schemaVersion: 2 },
    { ...request, forged: true },
    { ...request, call: { ...semanticCall, context: request.context } },
    { ...request, context: { schemaVersion: 1 } },
    {
      ...request,
      call: { ...semanticCall, capability: 'screen.applyChangeSet', arguments: { schemaVersion: 1, operations: [] } },
    },
    {
      ...request,
      context: {
        ...request.context,
        compensationTarget: { ...request.context.compensationTarget, sessionId: 'session-foreign' },
      },
    },
    {
      ...request,
      context: {
        ...request.context,
        compensationTarget: { ...request.context.compensationTarget, taskId: 'different-target' },
      },
    },
    {
      ...request,
      context: {
        ...request.context,
        compensationTarget: { ...request.context.compensationTarget, taskId: semanticCall.taskId },
      },
      call: {
        ...semanticCall,
        arguments: { schemaVersion: 1, targetTaskId: semanticCall.taskId },
      },
    },
    { ...request, context: { ...request.context, targetTaskId: 'model-controlled' } },
    {
      ...request,
      context: {
        ...request.context,
        compensationTarget: {
          schemaVersion: 1,
          taskId: 'target-task',
          sessionId: 'session-1',
          phase: 'COMPLETED',
          callIndex: [{ callId: 'target-call-1', capability: 'screen.applyChangeSet' }],
        },
      },
    },
    {
      ...request,
      context: {
        ...request.context,
        compensationTarget: { ...request.context.compensationTarget, callIndexComplete: false },
      },
    },
    {
      ...request,
      context: {
        ...request.context,
        compensationTarget: { ...request.context.compensationTarget, forged: true },
      },
    },
    {
      ...request,
      context: {
        ...request.context,
        compensationTarget: {
          ...request.context.compensationTarget,
          callIndex: [
            { callId: 'target-call-1', capability: 'screen.applyChangeSet' },
            { callId: 'target-call-1', capability: 'data.upsert' },
          ],
        },
      },
    },
  ]) {
    assert.throws(
      () => rpc.agentBoundaryRpcContracts['host.invoke'].parseRequest(invalid),
      error => ['invalid-field', 'unknown-field'].includes(error.code),
    )
  }
})

test('Host invoke RPC rejects accessor and non-enumerable fields without evaluating them', () => {
  let accessorReads = 0
  const accessorArguments = { schemaVersion: 1 }
  Object.defineProperty(accessorArguments, 'targetTaskId', {
    enumerable: true,
    get() {
      accessorReads += 1
      return 'target-task'
    },
  })
  const accessorRequest = {
    schemaVersion: 1,
    call: { ...semanticCall, arguments: accessorArguments },
    context: {
      schemaVersion: 1,
      compensationTarget: {
        schemaVersion: 1,
        taskId: 'target-task',
        sessionId: 'session-1',
        phase: 'COMPLETED',
        callIndexComplete: true,
        callIndex: [{ callId: 'target-call-1', capability: 'screen.applyChangeSet' }],
      },
    },
  }
  assert.throws(
    () => rpc.agentBoundaryRpcContracts['host.invoke'].parseRequest(accessorRequest),
    protocol.ProtocolValidationError,
  )
  assert.equal(accessorReads, 0)

  const hiddenFieldRequest = structuredClone({
    ...accessorRequest,
    call: semanticCall,
  })
  Object.defineProperty(hiddenFieldRequest.context, 'hidden', { enumerable: false, value: true })
  assert.throws(
    () => rpc.agentBoundaryRpcContracts['host.invoke'].parseRequest(hiddenFieldRequest),
    error => error instanceof protocol.ProtocolValidationError && error.code === 'unknown-field',
  )
})

test('Runtime compensate RPC accepts only an exact target task request', () => {
  const contract = runtimeContracts.runtimeRpcContracts['runtime.compensate']
  const request = { targetTaskId: 'target-task' }
  assert.deepEqual(contract.parseRequest(request), request)
  assert.equal(contract.parseResponse(null), null)

  for (const invalid of [
    {},
    { targetTaskId: '' },
    { targetTaskId: 'target-task', taskId: 'caller-controlled' },
    { targetTaskId: 'target-task', projectId: 'caller-controlled' },
  ]) {
    assert.throws(
      () => contract.parseRequest(invalid),
      error => error instanceof protocol.ProtocolValidationError || error instanceof TypeError,
    )
  }

  let reads = 0
  const accessor = {}
  Object.defineProperty(accessor, 'targetTaskId', {
    enumerable: true,
    get() {
      reads += 1
      return 'target-task'
    },
  })
  assert.throws(() => contract.parseRequest(accessor), protocol.ProtocolValidationError)
  assert.equal(reads, 0)
})

const createEchoContracts = () => ({
  echo: {
    parseRequest(value) {
      protocol.assertJsonValue(value)
      return value
    },
    parseResponse(value) {
      protocol.assertJsonValue(value)
      return value
    },
  },
})

const wrapPort = (port, postMessage) => ({
  postMessage: message => postMessage(message),
  addEventListener: (type, listener) => port.addEventListener(type, listener),
  removeEventListener: (type, listener) => port.removeEventListener(type, listener),
  start: () => port.start(),
  close: () => port.close(),
})

test('strict envelopes reject unknown data and enforce private resource limits', () => {
  const parsed = protocol.parseProtocolEnvelope(makeEnvelope())
  assert.equal(parsed.protocolVersion, 1)
  assert.equal(parsed.kind, 'rpc.request')
  assert.ok(Object.isFrozen(parsed))

  assert.throws(
    () => protocol.parseProtocolEnvelope(makeEnvelope({ extra: true })),
    error => error.code === 'unknown-field',
  )

  const full = {
    schemaVersion: 1,
    revision: 'revision-1',
    cursor: 'cursor-1',
    providerGenerations: { 'dashboard.core': 1 },
    projection: { 'dashboard.core': { nodes: {} } },
  }
  assert.deepEqual(rpc.agentBoundaryRpcContracts['host.observe'].parseResponse(full), full)
  for (const invalidFull of [
    { ...full, providerGenerations: {} },
    { ...full, providerGenerations: { 'dashboard.core': -1 } },
    {
      ...full,
      providerGenerations: JSON.parse('{"__proto__":1}'),
      projection: JSON.parse('{"__proto__":{}}'),
    },
  ]) {
    assert.throws(
      () => rpc.agentBoundaryRpcContracts['host.observe'].parseResponse(invalidFull),
      error => error.code === 'invalid-field',
    )
  }
  assert.throws(
    () => protocol.parseProtocolEnvelope(makeEnvelope({ protocolVersion: 2 })),
    error => error.code === 'protocol-version-mismatch',
  )
  assert.throws(
    () => protocol.parseProtocolEnvelope(makeEnvelope({ kind: 'rpc.mystery' })),
    error => error.code === 'unknown-kind',
  )
  const { taskId: omittedTaskId, ...missing } = makeEnvelope()
  assert.equal(omittedTaskId, 'task-1')
  assert.throws(
    () => protocol.parseProtocolEnvelope(missing),
    error => error.code === 'invalid-field',
  )

  protocol.assertJsonValue('x'.repeat(protocol.MAX_PROTOCOL_STRING_BYTES))
  assert.throws(
    () => protocol.assertJsonValue('x'.repeat(protocol.MAX_PROTOCOL_STRING_BYTES + 1)),
    error => error.code === 'string-too-large',
  )
  protocol.assertJsonValue(Array.from({ length: protocol.MAX_PROTOCOL_ARRAY_LENGTH }, () => null))
  assert.throws(
    () => protocol.assertJsonValue(Array.from({ length: protocol.MAX_PROTOCOL_ARRAY_LENGTH + 1 }, () => null)),
    error => error.code === 'array-too-large',
  )

  let atLimit = null
  for (let index = 0; index < protocol.MAX_PROTOCOL_NESTING_DEPTH; index += 1) atLimit = [atLimit]
  protocol.assertJsonValue(atLimit)
  assert.throws(
    () => protocol.assertJsonValue([atLimit]),
    error => error.code === 'nesting-too-deep',
  )

  protocol.assertEncodedMessageSize('x'.repeat(protocol.MAX_PROTOCOL_MESSAGE_BYTES - 2))
  assert.throws(
    () => protocol.assertEncodedMessageSize('x'.repeat(protocol.MAX_PROTOCOL_MESSAGE_BYTES - 1)),
    error => error.code === 'message-too-large',
  )
  assert.throws(
    () =>
      protocol.parseProtocolEnvelope(
        makeEnvelope({
          payload: {
            requestId: 'request-1',
            operation: 'echo',
            value: Array.from({ length: 17 }, () => 'x'.repeat(protocol.MAX_PROTOCOL_STRING_BYTES)),
          },
        }),
      ),
    error => error.code === 'message-too-large',
  )
})

test('protocol payloads remain JSON-safe and sentAt-free business fingerprints are deterministic', () => {
  const invalidValues = [undefined, () => {}, 1n, Symbol('value'), new Map(), new (class Engine {})()]
  for (const value of invalidValues) {
    assert.throws(
      () => protocol.assertJsonValue(value),
      error => error.code === 'invalid-json-value',
    )
  }
  const cyclic = {}
  cyclic.self = cyclic
  assert.throws(
    () => protocol.assertJsonValue(cyclic),
    error => error.code === 'invalid-json-value',
  )

  const first = protocol.parseProtocolEnvelope(makeEnvelope({ sentAt: 1 }))
  const second = protocol.parseProtocolEnvelope(makeEnvelope({ sentAt: 9999 }))
  assert.equal(protocol.createProtocolBusinessFingerprint(first), protocol.createProtocolBusinessFingerprint(second))
})

test('Host and Persistence contracts reject unknown fields and preserve structured-clone DTOs', () => {
  const observeRequest = {
    schemaVersion: 1,
    projectId: 'project-1',
    branchId: 'branch-1',
    sessionId: 'session-1',
    taskId: 'task-1',
    mode: 'full',
  }
  assert.deepEqual(rpc.agentBoundaryRpcContracts['host.observe'].parseRequest(observeRequest), observeRequest)
  assert.throws(
    () =>
      rpc.agentBoundaryRpcContracts['host.observe'].parseRequest({
        ...observeRequest,
        engine: { unsafe: true },
      }),
    error => error.code === 'unknown-field',
  )

  const delta = {
    schemaVersion: 1,
    baseRevision: 'revision-1',
    newRevision: 'revision-2',
    providerId: 'dashboard.core',
    providerGeneration: 1,
    baseCursor: 'cursor-1',
    newCursor: 'cursor-2',
    changes: [
      { op: 'set', path: ['nodes', 'node-1', 'props', 'title'], value: 'After' },
      { op: 'remove', path: ['nodes', 'node-2'] },
    ],
  }
  assert.deepEqual(rpc.agentBoundaryRpcContracts['host.observe'].parseResponse(delta), delta)
  const emptyNoOp = {
    ...delta,
    newRevision: delta.baseRevision,
    newCursor: 'cursor-no-op',
    changes: [],
  }
  assert.deepEqual(rpc.agentBoundaryRpcContracts['host.observe'].parseResponse(emptyNoOp), emptyNoOp)
  for (const stationary of [
    { ...delta, newCursor: delta.baseCursor },
    { ...delta, newRevision: delta.baseRevision },
  ]) {
    assert.throws(
      () => rpc.agentBoundaryRpcContracts['host.observe'].parseResponse(stationary),
      error => error.code === 'invalid-field',
    )
  }
  const invalidChanges = [
    [{ op: 'set', path: [], value: true }],
    [{ op: 'remove', path: ['nodes', '__proto__'] }],
    [{ op: 'set', path: ['nodes'], value: {}, extra: true }],
    [
      { op: 'set', path: ['nodes'], value: {} },
      { op: 'remove', path: ['nodes', 'node-1'] },
    ],
    [
      { op: 'set', path: ['nodes', 'node-1'], value: {} },
      { op: 'remove', path: ['nodes', 'node-1'] },
    ],
  ]
  for (const changes of invalidChanges) {
    assert.throws(
      () => rpc.agentBoundaryRpcContracts['host.observe'].parseResponse({ ...delta, changes }),
      error => ['invalid-field', 'unknown-field'].includes(error.code),
    )
  }
  assert.throws(
    () => rpc.agentBoundaryRpcContracts['host.observe'].parseResponse({ ...delta, providerId: '__proto__' }),
    error => error.code === 'invalid-field',
  )

  const batch = {
    schemaVersion: 1,
    projectId: 'project-1',
    branchId: 'branch-1',
    sessionId: 'session-1',
    batchId: 'batch-1',
    expectedPersistenceGeneration: 0,
    records: [{ recordId: 'record-1', kind: 'journal', value: { stable: true } }],
  }
  const cloned = structuredClone(batch)
  assert.deepEqual(rpc.agentBoundaryRpcContracts['persistence.commit'].parseRequest(cloned), batch)
  assert.notEqual(cloned, batch)

  const readRequest = {
    schemaVersion: 1,
    projectId: 'project-1',
    branchId: 'branch-1',
    sessionId: 'session-1',
    expectedPersistenceGeneration: 2,
  }
  const readResult = {
    schemaVersion: 1,
    projectId: 'project-1',
    branchId: 'branch-1',
    sessionId: 'session-1',
    persistenceGeneration: 2,
    records: [],
  }
  const commitResult = {
    schemaVersion: 1,
    batchId: 'batch-1',
    status: 'committed',
    persistenceGeneration: 3,
  }
  assert.deepEqual(rpc.agentBoundaryRpcContracts['persistence.read'].parseRequest(readRequest), readRequest)
  assert.deepEqual(rpc.agentBoundaryRpcContracts['persistence.read'].parseResponse(readResult), readResult)
  assert.deepEqual(rpc.agentBoundaryRpcContracts['persistence.commit'].parseResponse(commitResult), commitResult)

  const { expectedPersistenceGeneration: _readGeneration, ...legacyReadRequest } = readRequest
  const { persistenceGeneration: _readResultGeneration, ...legacyReadResult } = readResult
  const { expectedPersistenceGeneration: _batchGeneration, ...legacyBatch } = batch
  const { persistenceGeneration: _commitGeneration, ...legacyCommitResult } = commitResult
  for (const [parse, legacy] of [
    [
      rpc.agentBoundaryRpcContracts['persistence.read'].parseRequest,
      { ...legacyReadRequest, expectedDraftGeneration: 2 },
    ],
    [rpc.agentBoundaryRpcContracts['persistence.read'].parseResponse, { ...legacyReadResult, draftGeneration: 2 }],
    [rpc.agentBoundaryRpcContracts['persistence.commit'].parseRequest, { ...legacyBatch, expectedDraftGeneration: 0 }],
    [rpc.agentBoundaryRpcContracts['persistence.commit'].parseResponse, { ...legacyCommitResult, draftGeneration: 3 }],
  ]) {
    assert.throws(
      () => parse(legacy),
      error => ['invalid-field', 'unknown-field'].includes(error.code),
    )
  }
})

test('RPC peers deduplicate requests and responses without running a handler twice', async () => {
  const { port1, port2 } = new MessageChannel()
  const contracts = createEchoContracts()
  let calls = 0
  const duplicateRequests = wrapPort(port1, message => {
    port1.postMessage(message)
    if (message.kind === 'rpc.request') port1.postMessage(structuredClone(message))
  })
  const duplicateResponses = wrapPort(port2, message => {
    port2.postMessage(message)
    if (message.kind === 'rpc.response') port2.postMessage(structuredClone(message))
  })
  const client = rpc.createRpcPeer({
    port: duplicateRequests,
    contracts,
    clock: createClock(),
    idFactory: createIdFactory('client'),
    closePortOnDispose: true,
  })
  const server = rpc.createRpcPeer({
    port: duplicateResponses,
    contracts,
    handlers: {
      echo(value) {
        calls += 1
        return value
      },
    },
    clock: createClock(),
    idFactory: createIdFactory('server'),
    closePortOnDispose: true,
  })

  const input = { nested: ['structured', 'clone'] }
  const output = await client.request('echo', input, baseContext)
  assert.deepEqual(output, input)
  assert.notEqual(output, input)
  assert.equal(calls, 1)
  await delay(5)
  assert.ok(server.getStats().deduplicatedMessages >= 1)
  assert.ok(client.getStats().deduplicatedMessages >= 1)
  await Promise.all([client.dispose(), server.dispose()])
})

test('out-of-order responses do not settle a request with the wrong step', async () => {
  const { port1, port2 } = new MessageChannel()
  const contracts = createEchoContracts()
  const client = rpc.createRpcPeer({
    port: port1,
    contracts,
    clock: createClock(),
    idFactory: createIdFactory('client-order'),
    closePortOnDispose: true,
  })
  port2.start()
  port2.addEventListener(
    'message',
    event => {
      const request = protocol.parseProtocolEnvelope(event.data)
      const payload = rpc.parseRpcRequestPayload(request.payload)
      port2.postMessage(
        protocol.createProtocolEnvelope({
          ...baseContext,
          stepId: 'wrong-step',
          messageId: 'response-wrong',
          kind: 'rpc.response',
          sentAt: 1,
          payload: { requestId: payload.requestId, value: 'wrong' },
        }),
      )
      setTimeout(() => {
        port2.postMessage(
          protocol.createProtocolEnvelope({
            ...baseContext,
            messageId: 'response-correct',
            kind: 'rpc.response',
            sentAt: 2,
            payload: { requestId: payload.requestId, value: 'correct' },
          }),
        )
      }, 10)
    },
    { once: true },
  )

  let settled = false
  const request = client.request('echo', 'input', baseContext).then(value => {
    settled = true
    return value
  })
  await delay(3)
  assert.equal(settled, false)
  assert.equal(await request, 'correct')
  assert.equal(client.getStats().outOfOrderResponses, 1)
  await client.dispose()
  port2.close()
})

test('AbortSignal propagates as an explicit request-id abort envelope and disposal leaves no pending work', async () => {
  const { port1, port2 } = new MessageChannel()
  const contracts = createEchoContracts()
  let remoteAborted = false
  let handlerStarted
  const started = new Promise(resolve => {
    handlerStarted = resolve
  })
  const client = rpc.createRpcPeer({
    port: port1,
    contracts,
    clock: createClock(),
    idFactory: createIdFactory('client-abort'),
    closePortOnDispose: true,
  })
  const server = rpc.createRpcPeer({
    port: port2,
    contracts,
    handlers: {
      echo(_value, context) {
        handlerStarted()
        return new Promise((resolve, reject) => {
          context.signal.addEventListener(
            'abort',
            () => {
              remoteAborted = true
              reject(context.signal.reason)
            },
            { once: true },
          )
        })
      },
    },
    clock: createClock(),
    idFactory: createIdFactory('server-abort'),
    closePortOnDispose: true,
  })

  const controller = new AbortController()
  const request = client.request('echo', { waiting: true }, { ...baseContext, signal: controller.signal })
  await started
  controller.abort('user-cancelled')
  await assert.rejects(request, error => error.name === 'AbortError')
  for (let attempt = 0; attempt < 20 && !remoteAborted; attempt += 1) await delay(1)
  assert.equal(remoteAborted, true)
  assert.equal(client.getStats().pendingRequests, 0)
  await Promise.all([client.dispose(), server.dispose()])
  assert.equal(server.getStats().activeHandlers, 0)
})

test('rpc.abort cannot cancel a handler from a mismatched request context', async () => {
  const { port1, port2 } = new MessageChannel()
  const contracts = createEchoContracts()
  let remoteAborted = false
  let handlerStarted
  const started = new Promise(resolve => {
    handlerStarted = resolve
  })
  const protocolErrors = []
  const server = rpc.createRpcPeer({
    port: port2,
    contracts,
    handlers: {
      echo(_value, context) {
        handlerStarted()
        return new Promise((resolve, reject) => {
          context.signal.addEventListener(
            'abort',
            () => {
              remoteAborted = true
              reject(context.signal.reason)
            },
            { once: true },
          )
        })
      },
    },
    clock: createClock(),
    idFactory: createIdFactory('server-context-abort'),
    closePortOnDispose: true,
    onProtocolError: error => protocolErrors.push(error),
  })
  port1.start()
  port1.postMessage(
    protocol.createProtocolEnvelope({
      ...baseContext,
      messageId: 'context-request',
      kind: 'rpc.request',
      sentAt: 1,
      payload: { requestId: 'context-request-1', operation: 'echo', value: null },
    }),
  )
  await started

  port1.postMessage(
    protocol.createProtocolEnvelope({
      ...baseContext,
      stepId: 'attacker-step',
      messageId: 'context-abort-wrong',
      kind: 'rpc.abort',
      sentAt: 2,
      payload: { requestId: 'context-request-1', reason: 'mismatched-context' },
    }),
  )
  await delay(5)
  assert.equal(remoteAborted, false)
  assert.equal(server.getStats().abortedRequests, 0)
  assert.equal(protocolErrors.length, 1)

  port1.postMessage(
    protocol.createProtocolEnvelope({
      ...baseContext,
      messageId: 'context-abort-correct',
      kind: 'rpc.abort',
      sentAt: 3,
      payload: { requestId: 'context-request-1', reason: 'matching-context' },
    }),
  )
  for (let attempt = 0; attempt < 20 && !remoteAborted; attempt += 1) await delay(1)
  assert.equal(remoteAborted, true)
  assert.equal(server.getStats().abortedRequests, 1)
  await server.dispose()
  port1.close()
})

test('built-in Host/Persistence handlers roundtrip exact DTOs over real MessagePorts', async () => {
  const { port1, port2 } = new MessageChannel()
  const snapshot = {
    schemaVersion: 1,
    revision: 'revision-1',
    providerGenerations: { nodes: 1 },
    projection: { nodes: 2 },
  }
  const invocations = []
  const host = {
    observe: async () => snapshot,
    describeCapability: async request => ({
      schemaVersion: 1,
      capability: request.capability,
      revision: 'capability-1',
      input: {},
    }),
    invoke: async (call, context) => {
      invocations.push({ call, context })
      return { schemaVersion: 1, callId: call.callId, status: 'applied', revision: 'revision-2' }
    },
    queryReceipt: async request => ({
      schemaVersion: 1,
      projectId: request.projectId,
      branchId: request.branchId,
      callId: request.callId,
      status: 'not-applied',
      failure: { code: 'NO_CHANGE', message: 'already satisfied', retryable: false },
    }),
  }
  const persistence = {
    read: async request => ({
      schemaVersion: 1,
      projectId: request.projectId,
      branchId: request.branchId,
      sessionId: request.sessionId,
      persistenceGeneration: request.expectedPersistenceGeneration,
      records: [],
    }),
    commit: async batch => ({
      schemaVersion: 1,
      batchId: batch.batchId,
      status: 'committed',
      persistenceGeneration: batch.expectedPersistenceGeneration + 1,
    }),
  }
  const client = rpc.createRpcPeer({
    port: port1,
    contracts: rpc.agentBoundaryRpcContracts,
    clock: createClock(),
    idFactory: createIdFactory('boundary-client'),
    closePortOnDispose: true,
  })
  const server = rpc.createRpcPeer({
    port: port2,
    contracts: rpc.agentBoundaryRpcContracts,
    handlers: rpc.createAgentBoundaryRpcHandlers(host, persistence),
    clock: createClock(),
    idFactory: createIdFactory('boundary-server'),
    closePortOnDispose: true,
  })

  const observed = await client.request(
    'host.observe',
    {
      schemaVersion: 1,
      projectId: 'project-1',
      branchId: 'branch-1',
      sessionId: 'session-1',
      taskId: 'task-1',
      mode: 'full',
    },
    baseContext,
  )
  assert.deepEqual(observed, snapshot)

  const invocationContext = {
    schemaVersion: 1,
    compensationTarget: {
      schemaVersion: 1,
      taskId: 'target-task',
      sessionId: 'session-1',
      phase: 'COMPLETED',
      callIndexComplete: true,
      callIndex: [{ callId: 'target-call-1', capability: 'screen.applyChangeSet' }],
    },
  }
  const invoked = await client.request(
    'host.invoke',
    { schemaVersion: 1, call: semanticCall, context: invocationContext },
    baseContext,
  )
  assert.equal(invoked.status, 'applied')
  assert.deepEqual(invocations, [{ call: semanticCall, context: invocationContext }])

  const committed = await client.request(
    'persistence.commit',
    {
      schemaVersion: 1,
      projectId: 'project-1',
      branchId: 'branch-1',
      sessionId: 'session-1',
      batchId: 'batch-1',
      expectedPersistenceGeneration: 4,
      records: [],
    },
    baseContext,
  )
  assert.deepEqual(committed, {
    schemaVersion: 1,
    batchId: 'batch-1',
    status: 'committed',
    persistenceGeneration: 5,
  })
  const receipt = await client.request(
    'host.queryReceipt',
    {
      schemaVersion: 1,
      projectId: 'project-1',
      branchId: 'branch-1',
      sessionId: 'session-1',
      taskId: 'task-1',
      callId: 'call-1',
    },
    baseContext,
  )
  assert.equal(receipt.failure.code, 'NO_CHANGE')
  await Promise.all([client.dispose(), server.dispose()])
})

test('Persistence handlers preserve only allowlisted storage error codes across real MessagePorts', async () => {
  const { port1, port2 } = new MessageChannel()
  const host = {
    observe: async () => ({ schemaVersion: 1, revision: 'r1', providerGenerations: {}, projection: {} }),
    describeCapability: async request => ({
      schemaVersion: 1,
      capability: request.capability,
      revision: 'capability-1',
      input: {},
    }),
    invoke: async call => ({ schemaVersion: 1, callId: call.callId, status: 'not-applied' }),
    queryReceipt: async () => null,
  }
  const persistence = {
    read: async request => ({
      schemaVersion: 1,
      projectId: request.projectId,
      branchId: request.branchId,
      sessionId: request.sessionId,
      persistenceGeneration: 0,
      records: [],
    }),
    commit: async batch => {
      const error = new Error('must not cross the RPC boundary verbatim')
      error.code = batch.batchId === 'allowlisted' ? 'quota-exceeded' : 'private-backend-secret-code'
      throw error
    },
  }
  const client = rpc.createRpcPeer({
    port: port1,
    contracts: rpc.agentBoundaryRpcContracts,
    clock: createClock(),
    idFactory: createIdFactory('safe-error-client'),
    closePortOnDispose: true,
  })
  const server = rpc.createRpcPeer({
    port: port2,
    contracts: rpc.agentBoundaryRpcContracts,
    handlers: rpc.createAgentBoundaryRpcHandlers(host, persistence),
    clock: createClock(),
    idFactory: createIdFactory('safe-error-server'),
    closePortOnDispose: true,
  })
  const request = batchId =>
    client.request(
      'persistence.commit',
      {
        schemaVersion: 1,
        projectId: 'project-1',
        branchId: 'branch-1',
        sessionId: 'session-1',
        batchId,
        expectedPersistenceGeneration: 0,
        records: [],
      },
      baseContext,
    )

  await assert.rejects(request('allowlisted'), error => error.code === 'quota-exceeded')
  await assert.rejects(request('private'), error => error.code === 'rpc-handler-failed')
  await Promise.all([client.dispose(), server.dispose()])
})
