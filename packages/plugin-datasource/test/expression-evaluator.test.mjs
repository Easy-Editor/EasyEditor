import assert from 'node:assert/strict'
import test from 'node:test'

import {
  DataSourcePlugin,
  PolicyViolation,
  createDataSourceEngine,
  createDenyExpressionEvaluator,
  createEngine,
  createInterpret,
  createTrustedExpressionEvaluator,
  evaluateExpression,
  legacyTrustedExpressionEvaluator,
} from '../.test-dist/index.js'

const context = {
  state: { token: 'abc' },
  setState() {},
}

test('trusted evaluator preserves datasource expression and function semantics', () => {
  const evaluator = createTrustedExpressionEvaluator()

  assert.equal(
    evaluateExpression(evaluator, {
      source: 'this.state.token',
      kind: 'expression',
      thisValue: context,
    }),
    'abc',
  )

  const handler = evaluateExpression(evaluator, {
    source: 'function (suffix) { return this.state.token + suffix }',
    kind: 'function',
    thisValue: context,
  }).bind(context)
  assert.equal(handler('-123'), 'abc-123')
})

test('deny evaluator rejects before datasource code can execute', () => {
  const evaluator = createDenyExpressionEvaluator('datasource expressions are disabled')
  globalThis.__easyEditorDatasourceExecuted = false

  assert.throws(
    () =>
      evaluateExpression(evaluator, {
        source: 'globalThis.__easyEditorDatasourceExecuted = true',
        kind: 'expression',
        thisValue: context,
      }),
    error => error instanceof PolicyViolation && error.code === 'EXPRESSION_EVALUATION_DENIED',
  )
  assert.equal(globalThis.__easyEditorDatasourceExecuted, false)
  globalThis.__easyEditorDatasourceExecuted = undefined
})

test('missing datasource evaluator is a structured policy violation', () => {
  assert.throws(
    () => evaluateExpression(undefined, { source: '1 + 1', kind: 'expression' }),
    error => error instanceof PolicyViolation && error.reason === 'missing-evaluator',
  )
})

test('structurally compatible external evaluators preserve policy violations', () => {
  const externalDenial = new Error('external policy denied')
  externalDenial.code = 'EXPRESSION_EVALUATION_DENIED'
  const evaluator = {
    policy: 'external-deny',
    evaluate() {
      throw externalDenial
    },
  }

  assert.throws(
    () => evaluateExpression(evaluator, { source: '1 + 1', kind: 'expression' }),
    error => error === externalDenial,
  )
})

test('datasource construction propagates deny policy before handlers execute', () => {
  globalThis.__easyEditorDatasourceIntegrationExecuted = false
  const source = 'globalThis.__easyEditorDatasourceIntegrationExecuted = true'

  assert.throws(
    () =>
      createDataSourceEngine(
        {
          list: [],
          dataHandler: { type: 'JSExpression', value: source },
        },
        context,
        { expressionEvaluator: createDenyExpressionEvaluator() },
      ),
    error => error instanceof PolicyViolation && error.code === 'EXPRESSION_EVALUATION_DENIED',
  )
  assert.equal(globalThis.__easyEditorDatasourceIntegrationExecuted, false)
  globalThis.__easyEditorDatasourceIntegrationExecuted = undefined
})

test('an explicitly undefined plugin evaluator never falls back to legacy trusted execution', () => {
  assert.throws(
    () =>
      createDataSourceEngine(
        {
          list: [],
          dataHandler: { type: 'JSExpression', value: '40 + 2' },
        },
        context,
        { expressionEvaluator: undefined },
      ),
    error => error instanceof PolicyViolation && error.reason === 'missing-evaluator',
  )
})

test('omitting the datasource evaluator is fail-closed for executable schema', () => {
  globalThis.__easyEditorDatasourceImplicitExecution = false

  assert.throws(
    () =>
      createDataSourceEngine(
        {
          list: [],
          dataHandler: {
            type: 'JSExpression',
            value: 'globalThis.__easyEditorDatasourceImplicitExecution = true',
          },
        },
        context,
      ),
    error => error instanceof PolicyViolation && error.reason === 'missing-evaluator',
  )
  assert.equal(globalThis.__easyEditorDatasourceImplicitExecution, false)
  globalThis.__easyEditorDatasourceImplicitExecution = undefined
})

test('literal-only datasource schema remains usable without an evaluator', () => {
  const runtime = createDataSourceEngine(
    {
      list: [
        {
          id: 'literal-source',
          type: 'fetch',
          isInit: false,
          isSync: false,
          options: { uri: '/literal', method: 'GET' },
        },
      ],
    },
    context,
  )

  assert.deepEqual(Object.keys(runtime.dataSourceMap), ['literal-source'])
})

test('the public createInterpret factory is fail-closed without an evaluator', () => {
  assert.throws(
    () =>
      createInterpret(
        {
          list: [],
          dataHandler: { type: 'JSExpression', value: '() => 42' },
        },
        context,
        { requestHandlersMap: {} },
      ),
    error => error instanceof PolicyViolation && error.reason === 'missing-evaluator',
  )
})

test('the datasource plugin composes in a restricted engine without prototype authority', async t => {
  const engine = createEngine({ trustPolicy: 'agentRestricted', hostWindow: null })
  t.after(() => engine.destroy())

  await engine.plugins.register(DataSourcePlugin({ expressionEvaluator: createDenyExpressionEvaluator() }))
  await engine.init()

  assert.equal(engine.lifecycleState, 'ready')
  assert.equal(typeof engine.config.get('dataSourceEngine')?.createDataSourceEngine, 'function')
})

test('deleting the datasource plugin revokes cached capabilities and removes its config exposure', async t => {
  const engine = createEngine({ trustPolicy: 'agentRestricted', hostWindow: null })
  t.after(() => engine.destroy())

  await engine.plugins.register(DataSourcePlugin({ expressionEvaluator: createTrustedExpressionEvaluator() }))
  await engine.init()

  const capability = engine.config.get('dataSourceEngine')
  assert.equal(await engine.plugins.delete('DataSourcePlugin'), true)
  assert.equal(engine.config.has('dataSourceEngine'), false)
  assert.equal(engine.simulator?.dataSourceEngine, undefined)

  assert.throws(() => capability.createDataSourceEngine({ list: [] }, context), /datasource.*(?:disposed|stale)/i)
  assert.throws(() => capability.createInterpret({ list: [] }, context), /datasource.*(?:disposed|stale)/i)
  assert.throws(() => capability.createRuntime({ list: [] }, context), /datasource.*(?:disposed|stale)/i)
})

test('datasource plugin cleanup restores prior config without clobbering a later owner', async t => {
  const restoredEngine = createEngine({ hostWindow: null })
  const preservedEngine = createEngine({ hostWindow: null })
  t.after(async () => {
    await Promise.all([restoredEngine.destroy(), preservedEngine.destroy()])
  })

  const previousCapability = { owner: 'previous' }
  restoredEngine.config.set('dataSourceEngine', previousCapability)
  await restoredEngine.plugins.register(DataSourcePlugin())
  await restoredEngine.init()
  assert.notEqual(restoredEngine.config.get('dataSourceEngine'), previousCapability)
  await restoredEngine.plugins.delete('DataSourcePlugin')
  assert.equal(restoredEngine.config.get('dataSourceEngine'), previousCapability)

  const earlierCapability = { owner: 'earlier' }
  const laterCapability = { owner: 'later' }
  preservedEngine.config.set('dataSourceEngine', earlierCapability)
  await preservedEngine.plugins.register(DataSourcePlugin())
  await preservedEngine.init()
  const stalePluginCapability = preservedEngine.config.get('dataSourceEngine')
  preservedEngine.config.set('dataSourceEngine', laterCapability)
  await preservedEngine.plugins.delete('DataSourcePlugin')
  assert.equal(preservedEngine.config.get('dataSourceEngine'), laterCapability)
  assert.throws(
    () => stalePluginCapability.createDataSourceEngine({ list: [] }, context),
    /datasource.*(?:disposed|stale)/i,
  )
})

test('datasource capabilities are generation-bound across engine restart', async t => {
  const engine = createEngine({ hostWindow: null })
  t.after(() => engine.destroy())

  await engine.plugins.register(DataSourcePlugin())
  await engine.init()
  const firstGeneration = engine.config.get('dataSourceEngine')

  await engine.destroy()
  assert.throws(() => firstGeneration.createDataSourceEngine({ list: [] }, context), /datasource.*(?:disposed|stale)/i)

  await engine.init()
  const secondGeneration = engine.config.get('dataSourceEngine')
  assert.notEqual(secondGeneration, firstGeneration)
  assert.equal(typeof secondGeneration.createDataSourceEngine, 'function')
})

test('reload propagates delayed expression policy denials before requests and marks items as failed', async () => {
  for (const isSync of [false, true]) {
    for (const evaluator of [undefined, createDenyExpressionEvaluator()]) {
      let requestCalls = 0
      const runtime = createDataSourceEngine(
        {
          list: [
            {
              id: `protected-${isSync}-${evaluator?.policy ?? 'missing'}`,
              type: 'fetch',
              isInit: true,
              isSync,
              options: {
                uri: { type: 'JSExpression', value: '"/protected"' },
              },
            },
          ],
        },
        context,
        {
          expressionEvaluator: evaluator,
          requestHandlersMap: {
            fetch: async () => {
              requestCalls += 1
              return { data: 'should-not-run' }
            },
          },
        },
      )
      const [item] = Object.values(runtime.dataSourceMap)

      await assert.rejects(
        runtime.reloadDataSource(),
        error =>
          error instanceof PolicyViolation && error.reason === (evaluator ? 'policy-denied' : 'missing-evaluator'),
      )
      assert.equal(requestCalls, 0)
      assert.equal(item.status, 'error')
      assert.equal(item.error?.code, 'EXPRESSION_EVALUATION_DENIED')
    }
  }
})

test('legacy datasource execution requires the explicit compatibility evaluator', () => {
  const runtime = createDataSourceEngine(
    {
      list: [],
      dataHandler: { type: 'JSExpression', value: '() => this.state.token' },
    },
    context,
    { expressionEvaluator: legacyTrustedExpressionEvaluator },
  )

  assert.equal(runtime.reloadDataSource instanceof Function, true)
})

test('datasource evaluation failure logs contain metadata but no source or context', () => {
  const source = 'this.state.superSecretToken + }'
  const logs = []
  const originalConsoleError = console.error
  console.error = (...args) => logs.push(args)
  try {
    createDataSourceEngine(
      {
        list: [],
        dataHandler: { type: 'JSExpression', value: source },
      },
      context,
      { expressionEvaluator: createTrustedExpressionEvaluator({ policyName: 'test-trusted' }) },
    )
  } finally {
    console.error = originalConsoleError
  }

  assert.deepEqual(logs, [
    [
      'transformExpression.error',
      {
        code: 'EXPRESSION_EVALUATION_FAILED',
        policy: 'test-trusted',
        kind: 'expression',
        sourceLength: source.length,
      },
    ],
  ])
  assert.equal(JSON.stringify(logs).includes('superSecretToken'), false)
  assert.equal(JSON.stringify(logs).includes(context.state.token), false)
})
