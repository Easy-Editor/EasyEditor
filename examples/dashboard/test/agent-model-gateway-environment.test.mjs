import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AGENT_MODEL_GATEWAY_CONFIG_ENV,
  AGENT_MODEL_GATEWAY_ENABLED_ENV,
  MODEL_GATEWAY_PATH,
  createEnvironmentModelGatewayHandler,
  createEnvironmentModelGatewayMiddleware,
  isEnvironmentModelGatewayEnabled,
} from '../server/gateway/index.mjs'

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const secret = 'environment-provider-secret'
const prompt = 'private-environment-business-prompt'

const principal = {
  token: 'server-session-token',
  tenantId: 'tenant-1',
  userId: 'user-1',
  projectIds: ['project-1'],
}
const providerConfig = (overrides = {}) => ({
  providerId: 'provider-1',
  baseUrl: 'https://provider-one.example.test/v1',
  apiKey: secret,
  defaultModel: 'model-1',
  models: ['model-1'],
  timeoutMs: 1_000,
  ...overrides,
})
const configEnv = (auth, providers = [providerConfig()], overrides = {}) => ({
  [AGENT_MODEL_GATEWAY_ENABLED_ENV]: '1',
  [AGENT_MODEL_GATEWAY_CONFIG_ENV]: JSON.stringify({ auth, providers }),
  ...overrides,
})
const requestBody = (overrides = {}) => ({
  schemaVersion: 1,
  projectId: 'project-1',
  branchId: 'branch-1',
  sessionId: 'session-1',
  taskId: 'task-1',
  stepId: 'step-1',
  modelRequestId: 'model-request-1',
  providerId: 'provider-1',
  model: 'model-1',
  phase: 'PLAN_STEP',
  messages: [{ role: 'user', content: prompt }],
  maxOutputTokens: 128,
  ...overrides,
})
const transportRequest = (body = requestBody(), headers = {}) => ({
  method: 'POST',
  path: MODEL_GATEWAY_PATH,
  headers: { 'content-type': 'application/json', ...headers },
  body: encoder.encode(JSON.stringify(body)),
  signal: new AbortController().signal,
})

const collectFrames = async result => {
  let serialized = ''
  for await (const chunk of result.body) serialized += decoder.decode(chunk)
  return {
    frames: serialized
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line)),
    serialized,
  }
}
const errorCode = frames => frames.at(-1)?.error?.code

const completedTransport = calls => ({
  stream(input) {
    calls?.push(input)
    return (async function* () {
      yield { kind: 'completed', finishReason: 'stop' }
    })()
  },
})

test('environment gateway is default-off and falls through without constructing or calling a handler', async () => {
  let nextCalls = 0
  let handlerCalls = 0
  const middleware = createEnvironmentModelGatewayMiddleware({
    env: {},
    handler: {
      async handle() {
        handlerCalls += 1
      },
    },
  })

  assert.equal(isEnvironmentModelGatewayEnabled({}), false)
  assert.equal(isEnvironmentModelGatewayEnabled({ [AGENT_MODEL_GATEWAY_ENABLED_ENV]: 'true' }), false)
  assert.equal(isEnvironmentModelGatewayEnabled({ [AGENT_MODEL_GATEWAY_ENABLED_ENV]: '1' }), true)
  assert.equal(
    await middleware({}, {}, () => {
      nextCalls += 1
    }),
    false,
  )
  assert.equal(nextCalls, 1)
  assert.equal(handlerCalls, 0)
})

test('environment gateway bearer authorization binds the authenticated subject to its project', async () => {
  const providerCalls = []
  const handler = createEnvironmentModelGatewayHandler({
    env: configEnv({ mode: 'bearer', principals: [principal] }),
    providerTransport: completedTransport(providerCalls),
  })

  const allowed = await handler.handle(transportRequest(undefined, { authorization: `Bearer ${principal.token}` }))
  assert.equal(allowed.status, 200)
  assert.equal(errorCode((await collectFrames(allowed)).frames), undefined)
  assert.equal(providerCalls.length, 1)
  assert.deepEqual(providerCalls[0].principal, { tenantId: 'tenant-1', userId: 'user-1' })

  const denied = await handler.handle(
    transportRequest(requestBody({ projectId: 'project-2' }), { authorization: `Bearer ${principal.token}` }),
  )
  assert.equal(denied.status, 403)
  assert.equal(errorCode((await collectFrames(denied)).frames), 'UNAUTHORIZED')
  assert.equal(providerCalls.length, 1)
})

test('environment gateway accepts only its configured server cookie session', async () => {
  const calls = []
  const env = configEnv({
    mode: 'cookie-session',
    cookieName: '__Host-easy-editor-session',
    sessions: [principal],
  })
  const handler = createEnvironmentModelGatewayHandler({ env, providerTransport: completedTransport(calls) })
  const allowed = await handler.handle(
    transportRequest(undefined, { cookie: `__Host-easy-editor-session=${principal.token}` }),
  )
  assert.equal(errorCode((await collectFrames(allowed)).frames), undefined)

  const denied = await handler.handle(transportRequest())
  assert.equal(denied.status, 401)
  assert.equal(errorCode((await collectFrames(denied)).frames), 'UNAUTHORIZED')
  assert.equal(calls.length, 1)
})

test('external session authorization resolves every request so revocation is immediate', async () => {
  let revoked = false
  let resolverCalls = 0
  const calls = []
  const handler = createEnvironmentModelGatewayHandler({
    env: configEnv({ mode: 'external-session', cookieName: 'easy-editor-session' }),
    resolveSessionPrincipal: async ({ sessionId, projectId }) => {
      resolverCalls += 1
      assert.equal(sessionId, principal.token)
      assert.equal(projectId, 'project-1')
      return revoked ? null : principal
    },
    providerTransport: completedTransport(calls),
  })
  const transport = () => transportRequest(undefined, { cookie: `easy-editor-session=${principal.token}` })

  assert.equal(errorCode((await collectFrames(await handler.handle(transport()))).frames), undefined)
  revoked = true
  const denied = await handler.handle(transport())
  assert.equal(denied.status, 401)
  assert.equal(errorCode((await collectFrames(denied)).frames), 'UNAUTHORIZED')
  assert.equal(resolverCalls, 2)
  assert.equal(calls.length, 1)
})

const sseResponse = () => ({
  ok: true,
  status: 200,
  body: {
    async *[Symbol.asyncIterator]() {
      yield encoder.encode(
        `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`,
      )
    },
  },
})

test('environment gateway routes providers and enforces each configured model policy', async () => {
  const fetchCalls = []
  const secondSecret = 'second-server-only-secret'
  const env = configEnv({ mode: 'bearer', principals: [principal] }, [
    providerConfig(),
    providerConfig({
      providerId: 'provider-2',
      baseUrl: 'https://provider-two.example.test/openai',
      apiKey: secondSecret,
      defaultModel: 'model-2',
      models: ['model-2'],
    }),
  ])
  const handler = createEnvironmentModelGatewayHandler({
    env,
    fetchImpl: async (...args) => {
      fetchCalls.push(args)
      return sseResponse()
    },
  })
  const authorization = { authorization: `Bearer ${principal.token}` }
  const routed = await handler.handle(
    transportRequest(requestBody({ providerId: 'provider-2', model: 'model-2' }), authorization),
  )
  assert.equal(errorCode((await collectFrames(routed)).frames), undefined)
  assert.equal(fetchCalls[0][0], 'https://provider-two.example.test/openai/chat/completions')
  assert.equal(fetchCalls[0][1].headers.Authorization, `Bearer ${secondSecret}`)

  const unknown = await handler.handle(transportRequest(requestBody({ providerId: 'provider-unknown' }), authorization))
  assert.equal(unknown.status, 502)
  assert.equal(errorCode((await collectFrames(unknown)).frames), 'PROVIDER_UNAVAILABLE')

  const disallowed = await handler.handle(
    transportRequest(requestBody({ providerId: 'provider-2', model: 'model-forbidden' }), authorization),
  )
  assert.equal(disallowed.status, 502)
  assert.equal(errorCode((await collectFrames(disallowed)).frames), 'PROVIDER_FAILED')
  assert.equal(fetchCalls.length, 1)
})

test('missing and invalid enabled configuration fail closed without crashing startup', async () => {
  for (const env of [
    { [AGENT_MODEL_GATEWAY_ENABLED_ENV]: '1' },
    {
      [AGENT_MODEL_GATEWAY_ENABLED_ENV]: '1',
      [AGENT_MODEL_GATEWAY_CONFIG_ENV]: '{not-json',
    },
    configEnv({ mode: 'bearer', principals: [principal] }, [providerConfig(), providerConfig()]),
    configEnv({ mode: 'browser-indexeddb-grant', grants: ['forged'] }),
  ]) {
    const handler = createEnvironmentModelGatewayHandler({ env })
    const result = await handler.handle(
      transportRequest(undefined, { authorization: `Bearer ${principal.token}`, 'x-local-grant': 'forged' }),
    )
    assert.equal(result.status, 401)
    assert.equal(errorCode((await collectFrames(result)).frames), 'UNAUTHORIZED')
  }
})

test('environment secrets and provider failure details never enter public objects, frames, or logs', async () => {
  const logs = []
  const handler = createEnvironmentModelGatewayHandler({
    env: configEnv({ mode: 'bearer', principals: [principal] }),
    logger: { warn: value => logs.push(value) },
    fetchImpl: async () => {
      throw new Error(`${secret} ${prompt}`)
    },
  })
  assert.doesNotMatch(JSON.stringify(handler), new RegExp(secret))
  assert.deepEqual(Object.keys(handler).sort(), ['handle', 'path'])

  const result = await handler.handle(transportRequest(undefined, { authorization: `Bearer ${principal.token}` }))
  const { frames, serialized } = await collectFrames(result)
  assert.equal(errorCode(frames), 'PROVIDER_UNAVAILABLE')
  assert.doesNotMatch(serialized, new RegExp(`${secret}|${prompt}`))
  assert.doesNotMatch(JSON.stringify(logs), new RegExp(`${secret}|${prompt}`))
})
