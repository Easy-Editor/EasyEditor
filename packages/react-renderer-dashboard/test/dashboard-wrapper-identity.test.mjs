import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const React = require('react')
const { renderToString } = require('react-dom/server')
const dashboardWrapperSource = readFileSync(new URL('../src/renderer-core/hoc/dashboard.tsx', import.meta.url), 'utf8')

function loadDashboardWrapper(seenSchemas) {
  const output = ts.transpileModule(dashboardWrapperSource, {
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: 'dashboard.tsx',
  }).outputText

  const stubs = {
    '@easy-editor/react-renderer': {
      createForwardRefHocElement: Wrapper => Wrapper,
    },
    '@easy-editor/renderer-core': {
      classnames: (...values) => values.filter(Boolean).join(' '),
    },
    react: React,
    'react/jsx-runtime': require('react/jsx-runtime'),
    '../components': {
      DashboardWrapper: ({ children, schema }) =>
        React.createElement('section', { 'data-schema-title': schema.title }, children),
    },
    '../components/DashboardWrapper': {
      computeRect: schema => {
        seenSchemas.push(schema)
        return schema.rect
      },
    },
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

  return moduleRecord.exports.dashboardWrapper
}

test('keeps a dashboard node wrapper type stable while reading its latest schema', () => {
  const seenSchemas = []
  const dashboardWrapper = loadDashboardWrapper(seenSchemas)
  const baseRenderer = {
    props: {
      __host: {
        dashboardStyle: { mask: true },
        designMode: 'design',
      },
    },
  }
  const InitialComponent = ({ children, className }) =>
    React.createElement('div', { className, 'data-component': 'initial' }, children)
  const UpdatedComponent = ({ children, className }) =>
    React.createElement('div', { className, 'data-component': 'updated' }, children)
  const initialSchema = { id: 'node-1', rect: { height: 20, width: 20, x: 0, y: 0 }, title: 'initial' }
  const updatedSchema = { id: 'node-1', rect: { height: 20, width: 20, x: 12, y: 8 }, title: 'updated' }

  const InitialWrapper = dashboardWrapper(InitialComponent, { baseRenderer, schema: initialSchema })
  const UpdatedWrapper = dashboardWrapper(UpdatedComponent, { baseRenderer, schema: updatedSchema })

  assert.equal(UpdatedWrapper, InitialWrapper)

  const output = renderToString(React.createElement(UpdatedWrapper, null, 'content'))
  assert.equal(seenSchemas.at(-1), updatedSchema)
  assert.match(output, /data-component="updated"/)
  assert.match(output, /data-schema-title="updated"/)
  assert.match(output, /left:-12px/)
  assert.match(output, /top:-8px/)
})
