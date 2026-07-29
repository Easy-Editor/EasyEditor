import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const rendererSource = readFileSync(new URL('../src/simulator-renderer/simulator-renderer.ts', import.meta.url), 'utf8')

class FakeElement {
  constructor(ownerDocument) {
    this.ownerDocument = ownerDocument
    this.id = ''
    this.parentNode = null
    this.removeCalls = 0
    this.removeErrors = []
  }

  get isConnected() {
    return this.parentNode !== null
  }

  remove() {
    this.removeCalls += 1
    const error = this.removeErrors.shift()
    if (error) throw error
    this.parentNode?.removeChild(this)
  }
}

class FakeBody {
  constructor() {
    this.children = []
  }

  appendChild(child) {
    child.parentNode?.removeChild(child)
    this.children.push(child)
    child.parentNode = this
    return child
  }

  removeChild(child) {
    const index = this.children.indexOf(child)
    if (index >= 0) this.children.splice(index, 1)
    child.parentNode = null
    return child
  }
}

class FakeDocument {
  constructor() {
    this.body = new FakeBody()
    this.createdElements = []
    this.nextElementRemoveErrors = []
  }

  createElement() {
    const element = new FakeElement(this)
    element.removeErrors.push(...(this.nextElementRemoveErrors.shift() ?? []))
    this.createdElements.push(element)
    return element
  }

  getElementById(id) {
    return this.body.children.find(element => element.id === id) ?? null
  }
}

const noOpDecorator = () => undefined
noOpDecorator.ref = noOpDecorator

function loadRendererContainer(document, createRoot) {
  const output = ts.transpileModule(rendererSource, {
    compilerOptions: {
      esModuleInterop: true,
      experimentalDecorators: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      useDefineForClassFields: true,
    },
    fileName: 'simulator-renderer.ts',
  }).outputText

  const stubs = {
    '@easy-editor/core/instance': { isElementNode: () => false },
    './RendererView': { SimulatorRendererView: function SimulatorRendererView() {} },
    './document-instance': {
      DocumentInstance: class DocumentInstance {},
      REACT_KEY: Symbol('react-key'),
      SYMBOL_VDID: Symbol('document-id'),
      SYMBOL_VNID: Symbol('node-id'),
      cacheReactKey: value => value,
    },
    './utils': {
      buildComponents: () => ({}),
      getClientRects: () => [],
      reactFindDOMNodes: () => [],
      withQueryParams: value => value,
    },
    history: {
      createMemoryHistory: () => ({
        listen: () => () => {},
        location: { pathname: '/' },
        push() {},
        replace() {},
      }),
    },
    'lodash-es': { isPlainObject: () => false },
    mobx: {
      action: noOpDecorator,
      computed: noOpDecorator,
      observable: noOpDecorator,
      runInAction: operation => operation(),
      untracked: operation => operation(),
    },
    react: { createElement: (...args) => args },
    'react-dom/client': { createRoot },
  }
  const moduleRecord = { exports: {} }
  const require = id => {
    assert.ok(id in stubs, `unexpected runtime dependency: ${id}`)
    return stubs[id]
  }

  runInNewContext(output, {
    AggregateError,
    Error,
    console,
    document,
    exports: moduleRecord.exports,
    module: moduleRecord,
    require,
  })

  return moduleRecord.exports.SimulatorRendererContainer
}

function createRootController(plans = []) {
  const calls = []
  const createRoot = container => {
    const plan = plans.shift() ?? {}
    if (plan.createError) throw plan.createError

    const root = {
      renderCalls: 0,
      unmountCalls: 0,
      render() {
        this.renderCalls += 1
        const error = plan.renderErrors?.shift()
        if (error) throw error
      },
      unmount() {
        this.unmountCalls += 1
        const error = plan.unmountErrors?.shift()
        if (error) throw error
      },
    }
    calls.push({ container, root })
    return root
  }

  return { calls, createRoot }
}

const committedReadyReceipt = Object.freeze({
  committed: true,
  observerErrors: Object.freeze([]),
  status: 'committed',
})

function createHost({ iframe, readyErrors = [], readyReceipts = [] } = {}) {
  return {
    iframe,
    project: {
      readyCalls: 0,
      setRendererReady() {
        this.readyCalls += 1
        const error = readyErrors.shift()
        if (error) throw error
        return readyReceipts.shift() ?? committedReadyReceipt
      },
    },
  }
}

function createRenderer({ controller, document, host }) {
  const SimulatorRendererContainer = loadRendererContainer(document, controller.createRoot)
  const renderer = new SimulatorRendererContainer()
  Object.defineProperty(renderer, 'host', {
    configurable: true,
    get: () => host,
  })
  return renderer
}

function captureFailure(operation) {
  try {
    operation()
  } catch (error) {
    return error
  }
  assert.fail('expected operation to fail')
}

function flattenErrors(error) {
  if (!(error instanceof AggregateError)) return [error]
  return error.errors.flatMap(flattenErrors)
}

function assertContainsErrors(error, expected) {
  const causes = flattenErrors(error)
  for (const cause of expected) {
    assert.ok(causes.includes(cause), `expected aggregate failure to retain ${cause.message}`)
  }
}

test('dispose never removes host-owned iframe or a pre-existing fallback container', () => {
  const document = new FakeDocument()
  const iframe = document.createElement('iframe')
  const iframeController = createRootController([{}])
  const iframeRenderer = createRenderer({
    controller: iframeController,
    document,
    host: createHost({ iframe }),
  })

  iframeRenderer.run()
  iframeRenderer.dispose()

  assert.equal(iframeController.calls[0].root.unmountCalls, 1)
  assert.equal(iframe.removeCalls, 0)

  const preExistingFallback = document.createElement('div')
  preExistingFallback.id = 'easy-editor'
  document.body.appendChild(preExistingFallback)
  const fallbackController = createRootController([{}])
  const fallbackRenderer = createRenderer({
    controller: fallbackController,
    document,
    host: createHost(),
  })

  fallbackRenderer.run()
  fallbackRenderer.dispose()

  assert.strictEqual(fallbackController.calls[0].container, preExistingFallback)
  assert.equal(preExistingFallback.removeCalls, 0)
  assert.equal(preExistingFallback.isConnected, true)
})

test('an instance removes only its own fallback and repeated disposal is idempotent', () => {
  const document = new FakeDocument()
  const controller = createRootController([{}, {}])
  const renderer = createRenderer({ controller, document, host: createHost() })

  renderer.run()
  const firstFallback = controller.calls[0].container
  assert.equal(firstFallback.isConnected, true)

  renderer.dispose()
  assert.equal(firstFallback.isConnected, false)
  assert.equal(firstFallback.removeCalls, 1)
  assert.equal(controller.calls[0].root.unmountCalls, 1)

  renderer.dispose()
  assert.equal(firstFallback.removeCalls, 1)
  assert.equal(controller.calls[0].root.unmountCalls, 1)

  renderer.run()
  const secondFallback = controller.calls[1].container
  assert.notStrictEqual(secondFallback, firstFallback)
  assert.equal(secondFallback.isConnected, true)
  renderer.dispose()
  assert.equal(secondFallback.isConnected, false)
})

test('simultaneous fallback renderers lease distinct containers and dispose independently', async t => {
  for (const disposalOrder of [
    [0, 1],
    [1, 0],
  ]) {
    await t.test(`dispose ${disposalOrder.join(' then ')}`, () => {
      const document = new FakeDocument()
      const controller = createRootController([{}, {}])
      const SimulatorRendererContainer = loadRendererContainer(document, controller.createRoot)
      const renderers = [new SimulatorRendererContainer(), new SimulatorRendererContainer()]
      const hosts = [createHost(), createHost()]
      renderers.forEach((renderer, index) => {
        Object.defineProperty(renderer, 'host', {
          configurable: true,
          get: () => hosts[index],
        })
        renderer.run()
      })

      const containers = controller.calls.map(call => call.container)
      assert.notStrictEqual(containers[0], containers[1])
      assert.equal(containers[0].isConnected, true)
      assert.equal(containers[1].isConnected, true)

      renderers[disposalOrder[0]].dispose()
      assert.equal(containers[disposalOrder[0]].isConnected, false)
      assert.equal(containers[disposalOrder[1]].isConnected, true)
      assert.equal(controller.calls[disposalOrder[1]].root.unmountCalls, 0)

      renderers[disposalOrder[1]].dispose()
      assert.equal(containers[disposalOrder[1]].isConnected, false)
    })
  }
})

test('an explicitly shared host container rejects a second active React root', () => {
  const document = new FakeDocument()
  const sharedFrame = document.createElement('div')
  const controller = createRootController([{}, {}])
  const SimulatorRendererContainer = loadRendererContainer(document, controller.createRoot)
  const firstRenderer = new SimulatorRendererContainer()
  const secondRenderer = new SimulatorRendererContainer()
  for (const renderer of [firstRenderer, secondRenderer]) {
    Object.defineProperty(renderer, 'host', {
      configurable: true,
      get: () => createHost({ iframe: sharedFrame }),
    })
  }

  firstRenderer.run()
  assert.match(captureFailure(() => secondRenderer.run()).message, /already leased/)
  assert.equal(controller.calls.length, 1)
  assert.equal(sharedFrame.removeCalls, 0)

  firstRenderer.dispose()
  secondRenderer.run()
  assert.equal(controller.calls.length, 2)
  secondRenderer.dispose()
  assert.equal(sharedFrame.removeCalls, 0)
})

test('createRoot, render, and renderer-ready failures roll back owned state and permit retry', async t => {
  await t.test('createRoot failure', () => {
    const failure = new Error('createRoot failed')
    const document = new FakeDocument()
    const controller = createRootController([{ createError: failure }, {}])
    const renderer = createRenderer({ controller, document, host: createHost() })

    assert.strictEqual(
      captureFailure(() => renderer.run()),
      failure,
    )
    assert.equal(document.createdElements[0].isConnected, false)

    renderer.run()
    assert.equal(controller.calls.length, 1)
    assert.equal(controller.calls[0].container.isConnected, true)
    renderer.dispose()
  })

  await t.test('render failure', () => {
    const failure = new Error('render failed')
    const document = new FakeDocument()
    const controller = createRootController([{ renderErrors: [failure] }, {}])
    const renderer = createRenderer({ controller, document, host: createHost() })

    assert.strictEqual(
      captureFailure(() => renderer.run()),
      failure,
    )
    assert.equal(controller.calls[0].root.unmountCalls, 1)
    assert.equal(controller.calls[0].container.isConnected, false)

    renderer.run()
    assert.notStrictEqual(controller.calls[1].container, controller.calls[0].container)
    renderer.dispose()
  })

  await t.test('committed-shaped render failure', () => {
    const failure = Object.assign(new Error('render failed before readiness'), { committed: true })
    const document = new FakeDocument()
    const controller = createRootController([{ renderErrors: [failure] }, {}])
    const renderer = createRenderer({ controller, document, host: createHost() })

    assert.strictEqual(
      captureFailure(() => renderer.run()),
      failure,
    )
    assert.equal(controller.calls[0].root.unmountCalls, 1)
    assert.equal(controller.calls[0].container.isConnected, false)

    renderer.run()
    renderer.dispose()
  })

  await t.test('renderer-ready failure', () => {
    const failure = new Error('renderer ready failed')
    const document = new FakeDocument()
    const controller = createRootController([{}, {}])
    const host = createHost({ readyErrors: [failure] })
    const renderer = createRenderer({ controller, document, host })

    assert.strictEqual(
      captureFailure(() => renderer.run()),
      failure,
    )
    assert.equal(controller.calls[0].root.unmountCalls, 1)
    assert.equal(controller.calls[0].container.isConnected, false)

    renderer.run()
    assert.equal(host.project.readyCalls, 2)
    renderer.dispose()
  })
})

test('a committed renderer-ready observer failure keeps the root running and returns its receipt', () => {
  const observerFailure = new Error('renderer ready observer failed')
  const receipt = Object.freeze({
    committed: true,
    observerErrors: Object.freeze([observerFailure]),
    status: 'committed_with_observer_errors',
  })
  const document = new FakeDocument()
  const controller = createRootController([{}])
  const host = createHost({ readyReceipts: [receipt] })
  const renderer = createRenderer({ controller, document, host })

  assert.strictEqual(renderer.run(), receipt)
  assert.equal(controller.calls[0].root.unmountCalls, 0)
  assert.equal(controller.calls[0].container.isConnected, true)
  renderer.dispose()
  assert.equal(controller.calls[0].root.unmountCalls, 1)
})

test('incomplete startup rollback aggregates every failure and stays retryable through dispose', () => {
  const startupFailure = new Error('render failed')
  const unmountFailure = new Error('startup unmount failed')
  const removeFailure = new Error('startup remove failed')
  const document = new FakeDocument()
  document.nextElementRemoveErrors.push([removeFailure])
  const controller = createRootController([{ renderErrors: [startupFailure], unmountErrors: [unmountFailure] }, {}])
  const renderer = createRenderer({ controller, document, host: createHost() })

  const failure = captureFailure(() => renderer.run())
  assertContainsErrors(failure, [startupFailure, unmountFailure, removeFailure])
  assert.equal(controller.calls[0].container.isConnected, true)

  renderer.dispose()
  assert.equal(controller.calls[0].root.unmountCalls, 2)
  assert.equal(controller.calls[0].container.removeCalls, 2)
  assert.equal(controller.calls[0].container.isConnected, false)

  renderer.run()
  assert.notStrictEqual(controller.calls[1].container, controller.calls[0].container)
  renderer.dispose()
})

test('dispose retries only the cleanup steps that previously failed', async t => {
  await t.test('unmount failure does not starve fallback removal', () => {
    const unmountFailure = new Error('unmount failed')
    const document = new FakeDocument()
    const controller = createRootController([{ unmountErrors: [unmountFailure] }])
    const renderer = createRenderer({ controller, document, host: createHost() })

    renderer.run()
    const firstFailure = captureFailure(() => renderer.dispose())
    assertContainsErrors(firstFailure, [unmountFailure])
    assert.equal(controller.calls[0].root.unmountCalls, 1)
    assert.equal(controller.calls[0].container.removeCalls, 1)
    assert.equal(controller.calls[0].container.isConnected, false)

    renderer.dispose()
    assert.equal(controller.calls[0].root.unmountCalls, 2)
    assert.equal(controller.calls[0].container.removeCalls, 1)
  })

  await t.test('fallback removal failure does not repeat a successful unmount', () => {
    const removeFailure = new Error('remove failed')
    const document = new FakeDocument()
    document.nextElementRemoveErrors.push([removeFailure])
    const controller = createRootController([{}])
    const renderer = createRenderer({ controller, document, host: createHost() })

    renderer.run()
    const firstFailure = captureFailure(() => renderer.dispose())
    assertContainsErrors(firstFailure, [removeFailure])
    assert.equal(controller.calls[0].root.unmountCalls, 1)
    assert.equal(controller.calls[0].container.removeCalls, 1)
    assert.equal(controller.calls[0].container.isConnected, true)

    renderer.dispose()
    assert.equal(controller.calls[0].root.unmountCalls, 1)
    assert.equal(controller.calls[0].container.removeCalls, 2)
    assert.equal(controller.calls[0].container.isConnected, false)
  })
})

test('dispose detaches renderer observers before React unmount and retries only failed detachments', () => {
  const document = new FakeDocument()
  const controller = createRootController([{}])
  const renderer = createRenderer({ controller, document, host: createHost() })
  const trace = []
  let retryableCalls = 0

  renderer.run()
  const root = controller.calls[0].root
  const originalUnmount = root.unmount.bind(root)
  root.unmount = () => {
    trace.push('root:unmount')
    originalUnmount()
  }
  renderer.disposeFunctions.push(
    () => {
      trace.push('observer:stable')
    },
    () => {
      retryableCalls += 1
      trace.push(`observer:retry:${retryableCalls}`)
      if (retryableCalls === 1) throw new Error('transient observer detachment failure')
    },
  )

  assert.match(captureFailure(() => renderer.dispose()).message, /disposal completed with errors/)
  assert.deepEqual(trace, ['observer:retry:1', 'observer:stable', 'root:unmount'])

  renderer.dispose()
  assert.deepEqual(trace, ['observer:retry:1', 'observer:stable', 'root:unmount', 'observer:retry:2'])
  assert.equal(root.unmountCalls, 1)
})

test('observable renderer state is reset inside a MobX action boundary', () => {
  assert.doesNotMatch(rendererSource, /\buntracked\s*\(/)
  assert.match(
    rendererSource,
    /@action\s+rerender\s*\(\)\s*{[\s\S]*?this\._appContext\s*=\s*{\s*\.\.\.this\._appContext\s*}/,
  )
  assert.match(
    rendererSource,
    /runInAction\s*\(\s*\(\)\s*=>\s*{[\s\S]*?this\._documentInstances\s*=\s*failedDocumentInstances/,
  )
})

test('mount retries retained renderer cleanup before accepting a new host', () => {
  const unmountFailure = new Error('unmount failed')
  const document = new FakeDocument()
  const controller = createRootController([{ unmountErrors: [unmountFailure] }])
  const SimulatorRendererContainer = loadRendererContainer(document, controller.createRoot)
  const renderer = new SimulatorRendererContainer()
  renderer.init = () => {}
  const firstHost = createHost()
  const nextHost = createHost()

  renderer.mount(firstHost)
  renderer.run()
  assertContainsErrors(
    captureFailure(() => renderer.dispose()),
    [unmountFailure],
  )
  assert.equal(controller.calls[0].root.unmountCalls, 1)

  renderer.mount(nextHost)
  assert.equal(controller.calls[0].root.unmountCalls, 2)
  assert.strictEqual(renderer.host, nextHost)
  renderer.dispose()
})

test('same-host mount retries an incomplete startup rollback before returning', () => {
  const renderFailure = new Error('render failed')
  const unmountFailure = new Error('startup unmount failed')
  const document = new FakeDocument()
  const controller = createRootController([{ renderErrors: [renderFailure], unmountErrors: [unmountFailure] }])
  const SimulatorRendererContainer = loadRendererContainer(document, controller.createRoot)
  const renderer = new SimulatorRendererContainer()
  renderer.init = () => {}
  const host = createHost()

  renderer.mount(host)
  assertContainsErrors(
    captureFailure(() => renderer.run()),
    [renderFailure, unmountFailure],
  )
  assert.equal(controller.calls[0].root.unmountCalls, 1)

  renderer.mount(host)
  assert.equal(controller.calls[0].root.unmountCalls, 2)
  assert.strictEqual(renderer.host, host)
  renderer.dispose()
})

test('a stale renderer generation cannot remove the fallback owned by a newer renderer', () => {
  const document = new FakeDocument()
  const oldController = createRootController([{}])
  const oldRenderer = createRenderer({
    controller: oldController,
    document,
    host: createHost(),
  })
  oldRenderer.run()
  const oldFallback = oldController.calls[0].container

  oldFallback.remove()
  assert.equal(oldFallback.isConnected, false)

  const newController = createRootController([{}])
  const newRenderer = createRenderer({
    controller: newController,
    document,
    host: createHost(),
  })
  newRenderer.run()
  const newFallback = newController.calls[0].container
  assert.notStrictEqual(newFallback, oldFallback)
  assert.equal(newFallback.isConnected, true)

  oldRenderer.dispose()
  assert.equal(newFallback.isConnected, true)

  newRenderer.dispose()
  assert.equal(newFallback.isConnected, false)
})
