import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const rendererSource = readFileSync(new URL('../src/renderer-core/renderer/base.ts', import.meta.url), 'utf8')

function loadDashboardBaseRendererFactory() {
  const output = ts.transpileModule(rendererSource, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: 'base.ts',
  }).outputText

  class OriginBase {
    constructor(props) {
      this.props = props
      this.context = {
        engine: {
          createElement: (Component, elementProps) => ({ Component, elementProps }),
          props: { designMode: 'design' },
        },
      }
      this.__checkSchema = () => false
      this.__createVirtualDom = () => null
    }
  }

  const stubs = {
    '@easy-editor/core/instance': { isRemoteComponent: () => false },
    '@easy-editor/react-renderer': {
      baseRendererFactory: () => OriginBase,
      compWrapper: () => undefined,
      createRendererAdapter: () => ({}),
      leafWrapper: () => undefined,
    },
    '@easy-editor/renderer-core': {
      isSchema: () => true,
      isUseLoop: () => false,
    },
    '../components': { RemoteComponentLoading: function RemoteComponentLoading() {} },
    '../hoc/dashboard': { dashboardWrapper: () => undefined },
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
  })

  return moduleRecord.exports.dashboardBaseRendererFactory
}

test('propagates renderer identity and design context to child component renderers', () => {
  const ComponentRenderer = function ComponentRenderer() {}
  const dashboardBaseRendererFactory = loadDashboardBaseRendererFactory()
  const BaseRenderer = dashboardBaseRendererFactory({})
  const renderer = new BaseRenderer({
    __appHelper: {},
    __components: { ComponentRenderer },
    __container: { autoRepaintNode: true },
    __host: { designMode: 'design' },
    device: 'default',
    documentId: 'page-home',
    getNode: id => ({ id }),
    getSchemaChangedSymbol: () => false,
    setSchemaChangedSymbol: () => undefined,
  })

  const result = renderer.__createVirtualDom({ componentName: 'Div', id: 'node-1' }, { scope: true }, {}, 0)

  assert.equal(result.Component, ComponentRenderer)
  assert.equal(result.elementProps.documentId, 'page-home')
  assert.equal(result.elementProps.device, 'default')
  assert.equal(result.elementProps.__container, renderer.props.__container)
  assert.equal(result.elementProps.__host, renderer.props.__host)
  assert.equal(result.elementProps.getNode, renderer.props.getNode)
  assert.equal(result.elementProps.getSchemaChangedSymbol, renderer.props.getSchemaChangedSymbol)
  assert.equal(result.elementProps.setSchemaChangedSymbol, renderer.props.setSchemaChangedSymbol)
})
