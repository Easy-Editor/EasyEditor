import assert from 'node:assert/strict'
import test from 'node:test'

globalThis.location = { href: '?__logConf__=error:test-silent' }
const { baseRendererFactory, createDenyExpressionEvaluator, executeLifeCycleMethod, pageRendererFactory } =
  await import('../.test-dist/index.js')

const expression = value => ({ type: 'JSExpression', value })
const jsFunction = value => ({ type: 'JSFunction', value })

const createProps = (schema, extra = {}) => ({
  schema,
  components: {},
  __schema: schema,
  __components: {},
  ...extra,
})

test('explicit deny evaluator propagates through parseData, custom methods, lifecycle, and prop types', () => {
  globalThis.__reactRendererExpressionExecuted = false
  const requests = []
  const denyPolicy = createDenyExpressionEvaluator('denied by test policy')
  const denyEvaluator = {
    policy: denyPolicy.policy,
    evaluate(request) {
      requests.push(request)
      return denyPolicy.evaluate(request)
    },
  }
  const sideEffect = 'globalThis.__reactRendererExpressionExecuted = true'
  const schema = { componentName: 'Page', props: {} }
  const BaseRenderer = baseRendererFactory()
  const renderer = new BaseRenderer(createProps(schema, { expressionEvaluator: denyEvaluator }))

  assert.throws(
    () => renderer.__parseData(expression(sideEffect), renderer),
    error => error.code === 'EXPRESSION_EVALUATION_DENIED',
  )
  assert.throws(
    () =>
      renderer.__bindCustomMethods(
        createProps({
          ...schema,
          methods: { deniedMethod: jsFunction(`() => (${sideEffect})`) },
        }),
      ),
    error => error.code === 'EXPRESSION_EVALUATION_DENIED',
  )
  assert.throws(
    () =>
      executeLifeCycleMethod(
        renderer,
        {
          ...schema,
          lifeCycles: { probe: jsFunction(`() => (${sideEffect})`) },
        },
        'probe',
        [],
        denyEvaluator,
      ),
    error => error.code === 'EXPRESSION_EVALUATION_DENIED',
  )

  const propInfo = {
    schema,
    Comp: () => null,
    componentInfo: {
      name: 'DeniedComponent',
      props: {
        value: {
          extra: {
            propType: `(props) => { ${sideEffect}; return null }`,
          },
        },
      },
    },
  }
  assert.throws(
    () => renderer.__parseProps(7, renderer, 'value', propInfo),
    error => error.code === 'EXPRESSION_EVALUATION_DENIED',
  )
  assert.throws(
    () =>
      renderer.__parseProps(jsFunction(`() => (${sideEffect})`), renderer, 'handler', {
        schema,
        Comp: () => null,
        componentInfo: { name: 'DeniedComponent', props: {} },
      }),
    error => error.code === 'EXPRESSION_EVALUATION_DENIED',
  )
  renderer.context = {
    engine: {
      props: {},
      createElement: () => null,
      getFaultComponent: () => () => null,
    },
  }
  assert.throws(
    () => renderer.__createVirtualDom(expression(sideEffect), renderer, { schema, Comp: () => null }),
    error => error.code === 'EXPRESSION_EVALUATION_DENIED',
  )

  assert.equal(globalThis.__reactRendererExpressionExecuted, false)
  assert.ok(requests.some(request => request.source === sideEffect && request.kind === 'expression'))
  assert.ok(
    requests.some(
      request => request.source.includes('__reactRendererExpressionExecuted') && request.kind === 'function',
    ),
  )
  assert.ok(requests.some(request => request.kind === 'prop-type-rule'))
  globalThis.__reactRendererExpressionExecuted = undefined
})

test('an explicit undefined evaluator never falls back to the app helper or legacy trusted mode', () => {
  globalThis.__reactRendererExpressionExecuted = false
  let appHelperEvaluatorCalls = 0
  const appHelperEvaluator = {
    policy: 'app-helper-test',
    evaluate() {
      appHelperEvaluatorCalls += 1
      globalThis.__reactRendererExpressionExecuted = true
      return () => undefined
    },
  }
  const source = 'globalThis.__reactRendererExpressionExecuted = true'
  const schema = {
    componentName: 'Page',
    props: {},
    state: { deniedState: expression(source) },
    dataSource: { dataHandler: expression(`() => (${source})`) },
  }
  const PageRenderer = pageRendererFactory()
  assert.throws(
    () =>
      new PageRenderer(
        createProps(schema, {
          __appHelper: { expressionEvaluator: appHelperEvaluator },
          expressionEvaluator: undefined,
        }),
      ),
    error => error.code === 'EXPRESSION_EVALUATION_DENIED' && error.reason === 'missing-evaluator',
  )

  assert.equal(appHelperEvaluatorCalls, 0)
  assert.equal(globalThis.__reactRendererExpressionExecuted, false)
  globalThis.__reactRendererExpressionExecuted = undefined
})

test('omitting expressionEvaluator preserves legacy trusted renderer behavior', () => {
  const schema = {
    componentName: 'Page',
    props: {},
    state: { answer: expression('40 + 2') },
    methods: { double: jsFunction('value => value * 2') },
    dataSource: { dataHandler: expression('value => value + 1') },
  }
  const PageRenderer = pageRendererFactory()
  const page = new PageRenderer(createProps(schema))

  assert.equal(page.state.answer, 42)
  assert.equal(page.double(4), 8)
  assert.equal(page.__dataHelper.dataHandler(4), 5)
  assert.equal(page.__parseData(expression('this.answer + 1'), { answer: 41 }), 42)

  const handler = page.__parseProps(jsFunction('value => value * 3'), page, 'handler', {
    schema,
    Comp: () => null,
    componentInfo: { name: 'LegacyComponent', props: {} },
  })
  assert.equal(handler(3), 9)

  const propValue = page.__parseProps(7, page, 'value', {
    schema,
    Comp: () => null,
    componentInfo: {
      name: 'LegacyComponent',
      props: { value: { extra: { propType: 'props => props.value === 7 ? null : new Error("invalid")' } } },
    },
  })
  assert.equal(propValue, 7)

  assert.equal(
    executeLifeCycleMethod(
      page,
      {
        componentName: 'Page',
        props: {},
        lifeCycles: { probe: jsFunction('() => 42') },
      },
      'probe',
      [],
    ),
    42,
  )
})

test('nested renderer props preserve explicit evaluator ownership', () => {
  const BaseRenderer = baseRendererFactory()
  const evaluator = { policy: 'test', evaluate: () => undefined }
  const schema = { componentName: 'Page', props: {} }
  const renderer = new BaseRenderer(createProps(schema, { expressionEvaluator: evaluator }))
  renderer.context = {
    engine: {
      props: {},
      createElement(_component, props) {
        return props
      },
      getNotFoundComponent: () => () => null,
      getFaultComponent: () => () => null,
    },
  }
  renderer.__getComponentView = () => () => null
  renderer.__getComponentProps = () => ({})
  renderer.__getHOCWrappedComponent = component => component
  renderer.__getSchemaChildrenVirtualDom = () => null

  const childProps = renderer.__createVirtualDom({ componentName: 'Child', id: 'child', props: {} }, renderer, {
    schema,
    Comp: () => null,
  })

  assert.equal(Object.hasOwn(childProps, 'expressionEvaluator'), true)
  assert.equal(childProps.expressionEvaluator, evaluator)
})
