import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const dashboardRoot = fileURLToPath(new URL('..', import.meta.url))
const contract = await import('../src/editor/data/contract.mjs')
const bindingRuntime = await import('../src/editor/data/binding-runtime.mjs')

const loadBinding = () => {
  const filename = resolve(dashboardRoot, 'src/editor/data/binding.ts')
  const output = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText
  const loaded = { exports: {} }
  new Function('require', 'module', 'exports', output)(
    request => {
      if (request === './contract.mjs') return contract
      if (request === './binding-runtime.mjs') return bindingRuntime
      throw new Error(`Unexpected dependency ${request}`)
    },
    loaded,
    loaded.exports,
  )
  return loaded.exports
}

const binding = loadBinding()

const loadTextComponent = () => {
  const filename = resolve(dashboardRoot, 'src/editor/materials/basic/text/component.tsx')
  const output = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: {
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText
  const loaded = { exports: {} }
  new Function('require', 'module', 'exports', output)(
    request => {
      if (request === '../../../data/binding') return binding
      if (request === 'react/jsx-runtime') return { jsx: (type, props) => ({ type, props }) }
      throw new Error(`Unexpected dependency ${request}`)
    },
    loaded,
    loaded.exports,
  )
  return loaded.exports.default
}

test('material binding resolves only renderer-provided page data through the closed transform AST', () => {
  const dataBindings = {
    schemaVersion: 1,
    fields: {
      text: { sourceId: 'summary', transform: [{ op: 'select', path: ['label'] }] },
      data: { sourceId: 'rows', transform: [{ op: 'take', count: 1 }] },
    },
  }
  const dataSource = { page: { summary: { label: 'bound' }, rows: [{ value: 1 }, { value: 2 }] } }

  assert.equal(
    binding.resolveDashboardMaterialBinding({ bindingField: 'text', dataBindings, dataSource, fallback: 'manual' }),
    'bound',
  )
  assert.deepEqual(
    binding.resolveDashboardMaterialBinding({ bindingField: 'data', dataBindings, dataSource, fallback: [] }),
    [{ value: 1 }],
  )
})

test('manual material values remain the fallback for absent, invalid, or unresolved bindings', () => {
  const fallback = [{ month: 'January', desktop: 186 }]
  assert.strictEqual(binding.resolveDashboardRows({ invalid: true }, fallback), fallback)
  assert.strictEqual(binding.resolveDashboardMaterialBinding({ bindingField: 'data', fallback }), fallback)
  assert.strictEqual(
    binding.resolveDashboardMaterialBinding({
      bindingField: 'data',
      dataBindings: { schemaVersion: 1, fields: { data: { sourceId: '__proto__' } } },
      dataSource: { page: {} },
      fallback,
    }),
    fallback,
  )
})

test('material binding never evaluates renderer-owned accessors', () => {
  let getterReads = 0
  const page = {}
  Object.defineProperty(page, 'rows', {
    enumerable: true,
    get() {
      getterReads += 1
      return [{ value: 'stolen' }]
    },
  })
  const fallback = [{ value: 'manual' }]
  assert.strictEqual(
    binding.resolveDashboardMaterialBinding({
      bindingField: 'data',
      dataBindings: { schemaVersion: 1, fields: { data: { sourceId: 'rows' } } },
      dataSource: { page },
      fallback,
    }),
    fallback,
  )
  assert.equal(getterReads, 0)
})

test('Text retains its normalized manual fallback when resolved bound data is an object or array', () => {
  const Text = loadTextComponent()
  const dataBindings = { schemaVersion: 1, fields: { text: { sourceId: 'summary' } } }
  for (const resolvedValue of [{ label: 'incompatible' }, ['incompatible']]) {
    const rendered = Text({
      ref: null,
      text: 'MANUAL_TEXT_FALLBACK',
      dataBindings,
      __dataSource: { page: { summary: resolvedValue } },
    })
    assert.equal(rendered.props.children, 'MANUAL_TEXT_FALLBACK')
  }
})

test('Text, BarChart, and LineChart share the pure binding resolver and never fetch', () => {
  const files = [
    'src/editor/materials/basic/text/component.tsx',
    'src/editor/materials/chart/bar-chart/component.tsx',
    'src/editor/materials/chart/line-chart/component.tsx',
  ]
  for (const file of files) {
    const source = readFileSync(resolve(dashboardRoot, file), 'utf8')
    assert.match(source, /resolveDashboardMaterialBinding/)
    assert.doesNotMatch(source, /\bfetch\s*\(/)
  }
})
