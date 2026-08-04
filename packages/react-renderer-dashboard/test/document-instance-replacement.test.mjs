import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const nodeRequire = createRequire(import.meta.url)
const rendererSource = readFileSync(new URL('../src/simulator-renderer/simulator-renderer.ts', import.meta.url), 'utf8')

const noOpDecorator = () => undefined
noOpDecorator.ref = noOpDecorator

class FakeDocumentInstance {
  disposeCalls = 0

  constructor(container, document) {
    this.container = container
    this.document = document
  }

  get path() {
    return `/${this.document.fileName}`
  }

  dispose() {
    this.disposeCalls += 1
  }
}

function loadRendererContainer() {
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
      DocumentInstance: FakeDocumentInstance,
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
    history: nodeRequire('history'),
    'lodash-es': { isPlainObject: () => false },
    mobx: {
      action: noOpDecorator,
      computed: noOpDecorator,
      observable: noOpDecorator,
      runInAction: operation => operation(),
      untracked: operation => operation(),
    },
    react: { createElement: (...args) => args },
    'react-dom/client': { createRoot: () => ({ render() {}, unmount() {} }) },
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
    document: {},
    exports: moduleRecord.exports,
    module: moduleRecord,
    require,
  })

  return moduleRecord.exports.SimulatorRendererContainer
}

function createHost(documents) {
  let autorunCallback
  const project = {
    documents,
    currentDocument: documents[0] ?? null,
    get: () => ({}),
    open() {},
  }

  return {
    appHelper: {},
    autoRender: true,
    dataSourceEngine: null,
    designMode: 'design',
    designer: { materials: { componentsMap: {} } },
    device: 'default',
    project,
    autorun(callback) {
      autorunCallback = callback
      callback()
      return () => {}
    },
    connect(_target, callback) {
      callback()
      return () => {}
    },
    rerunAutorun() {
      autorunCallback()
    },
  }
}

test('replaces and disposes a cached instance when the document object changes under the same id', () => {
  const SimulatorRendererContainer = loadRendererContainer()
  const oldDocument = { id: 'home', fileName: 'home' }
  const host = createHost([oldDocument])
  const renderer = new SimulatorRendererContainer()
  renderer.mount(host)

  const oldInstance = renderer.documentInstances[0]
  const replacementDocument = { id: 'home', fileName: 'home' }
  host.project.documents = [replacementDocument]
  host.project.currentDocument = replacementDocument
  host.rerunAutorun()

  const replacementInstance = renderer.documentInstances[0]
  assert.notStrictEqual(replacementInstance, oldInstance)
  assert.strictEqual(replacementInstance.document, replacementDocument)
  assert.equal(oldInstance.disposeCalls, 1)
})

test('disposes and removes cached instances for documents no longer in the project', () => {
  const SimulatorRendererContainer = loadRendererContainer()
  const document = { id: 'home', fileName: 'home' }
  const host = createHost([document])
  const renderer = new SimulatorRendererContainer()
  renderer.mount(host)

  const instance = renderer.documentInstances[0]
  host.project.documents = []
  host.project.currentDocument = null
  host.rerunAutorun()

  assert.deepEqual(renderer.documentInstances, [])
  assert.equal(instance.disposeCalls, 1)
})

test('replaces history entries when the renderer aligns the active document route', () => {
  const SimulatorRendererContainer = loadRendererContainer()
  const homeDocument = { id: 'home', fileName: 'home' }
  const secondDocument = { id: 'second', fileName: 'second' }
  const host = createHost([homeDocument, secondDocument])
  const renderer = new SimulatorRendererContainer()
  renderer.mount(host)

  assert.equal(renderer.history.location.pathname, '/home')
  assert.equal(renderer.history.action, 'REPLACE')

  host.project.currentDocument = secondDocument
  host.rerunAutorun()

  assert.equal(renderer.history.location.pathname, '/second')
  assert.equal(renderer.history.action, 'REPLACE')

  host.project.documents = [homeDocument]
  host.project.currentDocument = homeDocument
  host.rerunAutorun()

  assert.equal(renderer.history.location.pathname, '/home')
  assert.equal(renderer.history.action, 'REPLACE')
})
