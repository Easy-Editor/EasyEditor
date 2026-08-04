import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const React = require('react')
const { renderToString } = require('react-dom/server')
const reactRouterDom = require('react-router-dom')
const { createMemoryHistory } = require('history')
const rendererViewSource = readFileSync(new URL('../src/simulator-renderer/RendererView.tsx', import.meta.url), 'utf8')

function loadSimulatorRendererView() {
  const output = ts.transpileModule(rendererViewSource, {
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: 'RendererView.tsx',
  }).outputText

  const stubs = {
    '@easy-editor/core/instance': { DESIGNER_EVENT: { NODE_RENDER: 'node-render' } },
    'mobx-react': { observer: component => component },
    react: React,
    'react-router-dom': reactRouterDom,
    'react/jsx-runtime': require('react/jsx-runtime'),
    '../renderer-core': props =>
      React.createElement('span', { 'data-document-id': props.documentId }, props.documentId),
  }
  const moduleRecord = { exports: {} }
  const localRequire = id => {
    assert.ok(id in stubs, `unexpected runtime dependency: ${id}`)
    return stubs[id]
  }

  runInNewContext(output, {
    console,
    exports: moduleRecord.exports,
    module: moduleRecord,
    require: localRequire,
    window: { parent: {} },
  })

  return moduleRecord.exports.SimulatorRendererView
}

function createDocumentInstance(container, id, path) {
  return {
    container,
    document: { id },
    getNode: () => undefined,
    mountInstance() {},
    path,
    schema: {},
    suspended: false,
  }
}

function createSimulatorRenderer(history) {
  const host = {
    currentDocument: undefined,
    designer: { postEvent() {} },
  }
  const simulatorRenderer = {
    autoRender: true,
    components: {},
    context: { expressionEvaluator: {} },
    designMode: 'design',
    device: 'default',
    documentInstances: [],
    history,
    host,
    layout: undefined,
  }

  return simulatorRenderer
}

test('renders the current document while its stale route is being replaced', () => {
  const SimulatorRendererView = loadSimulatorRendererView()
  const history = createMemoryHistory({ initialEntries: ['/second'] })
  const simulatorRenderer = createSimulatorRenderer(history)
  const homeInstance = createDocumentInstance(simulatorRenderer, 'home', '/home')
  simulatorRenderer.documentInstances = [homeInstance]
  simulatorRenderer.host.currentDocument = homeInstance.document
  const warnings = []
  const originalWarn = console.warn
  console.warn = (...args) => warnings.push(args)

  let output
  try {
    output = renderToString(React.createElement(SimulatorRendererView, { simulatorRenderer }))
  } finally {
    console.warn = originalWarn
  }

  assert.equal(
    warnings.some(args => String(args[0]).includes('No routes matched location')),
    false,
  )
  assert.match(output, /data-document-id="home"/)
})

test('keeps pathname routing authoritative when the route still exists', () => {
  const SimulatorRendererView = loadSimulatorRendererView()
  const history = createMemoryHistory({ initialEntries: ['/second'] })
  const simulatorRenderer = createSimulatorRenderer(history)
  const homeInstance = createDocumentInstance(simulatorRenderer, 'home', '/home')
  const secondInstance = createDocumentInstance(simulatorRenderer, 'second', '/second')
  simulatorRenderer.documentInstances = [homeInstance, secondInstance]
  simulatorRenderer.host.currentDocument = homeInstance.document

  const output = renderToString(React.createElement(SimulatorRendererView, { simulatorRenderer }))

  assert.match(output, /data-document-id="second"/)
  assert.doesNotMatch(output, /data-document-id="home"/)
})
