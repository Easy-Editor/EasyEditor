import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, relative, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { compileSafeMaterialManifest } from '../src/editor/agent/manifest/index.mjs'

const require = createRequire(import.meta.url)
const dashboardRoot = fileURLToPath(new URL('..', import.meta.url))
const moduleCache = new Map()

const resolveTypeScriptModule = (request, parentFilename) => {
  const basePath = resolve(dirname(parentFilename), request)
  const candidates = [basePath, `${basePath}.ts`, `${basePath}.tsx`, resolve(basePath, 'index.ts')]
  return candidates.find(candidate => {
    try {
      readFileSync(candidate)
      return true
    } catch {
      return false
    }
  })
}

const loadTypeScriptModule = relativePath => {
  const filename = resolve(dashboardRoot, relativePath)
  const cached = moduleCache.get(filename)
  if (cached) return cached.exports

  const source = readFileSync(filename, 'utf8')
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText
  const loadedModule = { exports: {} }
  moduleCache.set(filename, loadedModule)

  const localRequire = request => {
    if (request === '@easy-editor/core') return {}
    if (request.endsWith('.css')) return {}
    if (request.startsWith('.')) {
      const resolved = resolveTypeScriptModule(request, filename)
      if (!resolved) throw new Error(`Unable to resolve ${request} from ${filename}`)
      return loadTypeScriptModule(relative(dashboardRoot, resolved))
    }
    return require(request)
  }

  const evaluate = new Function('require', 'module', 'exports', transpiled)
  evaluate(localRequire, loadedModule, loadedModule.exports)
  return loadedModule.exports
}

const flattenFields = items =>
  items.flatMap(item => [item, ...(Array.isArray(item.items) ? flattenFields(item.items) : [])])

test('Div renders children and clamps unsafe presentation values', () => {
  const Div = loadTypeScriptModule('src/editor/materials/inner/div/component.tsx').default
  const React = require('react')
  const decoratedMarkup = renderToStaticMarkup(
    React.createElement(
      Div,
      {
        background: 'linear-gradient(90deg, #fff, #eee)',
        borderColor: '#c6a66b',
        borderRadius: 12,
        borderWidth: 2,
        opacity: 80,
        overflow: 'hidden',
        panelInset: 28,
        panelShape: 'hud-right',
        visualPreset: 'corner-frame',
        shadowBlur: 16,
        shadowColor: 'rgba(0, 0, 0, 0.2)',
        shadowOffsetY: 6,
      },
      React.createElement('span', null, '区域内容'),
    ),
  )

  assert.match(decoratedMarkup, /区域内容/u)
  assert.match(decoratedMarkup, /border:2px solid #c6a66b/u)
  assert.match(decoratedMarkup, /border-radius:12px/u)
  assert.match(decoratedMarkup, /box-shadow:0 6px 16px rgba\(0, 0, 0, 0\.2\)/u)
  assert.match(decoratedMarkup, /opacity:0\.8/u)
  assert.match(decoratedMarkup, /overflow:hidden/u)
  assert.match(decoratedMarkup, /data-div-panel-shape="hud-right"/u)
  assert.match(decoratedMarkup, /data-div-visual-preset="corner-frame"/u)
  assert.match(decoratedMarkup, /linear-gradient\(#75cbe8/u)
  assert.match(decoratedMarkup, /clip-path:polygon\(28px 28px, 100% 0, 100% 100%, 0 calc\(100% - 28px\)\)/u)

  const clampedMarkup = renderToStaticMarkup(
    React.createElement(Div, { borderRadius: -8, borderWidth: -2, opacity: 180 }),
  )
  assert.match(clampedMarkup, /border:0px solid transparent/u)
  assert.match(clampedMarkup, /border-radius:0/u)
  assert.match(clampedMarkup, /opacity:1/u)
})

test('Div configure is a container with a ready writable Agent manifest', () => {
  const configure = loadTypeScriptModule('src/editor/materials/inner/div/configure.ts').default
  const fields = flattenFields(configure.props)
  const fieldNames = new Set(fields.map(field => field.name ?? field.key).filter(Boolean))

  assert.equal(configure.component?.isContainer, true)
  for (const fieldName of [
    'background',
    'borderColor',
    'borderWidth',
    'borderRadius',
    'opacity',
    'panelShape',
    'panelInset',
    'visualPreset',
    'overflow',
    'shadowColor',
    'shadowBlur',
    'shadowOffsetY',
  ]) {
    assert.equal(fieldNames.has(fieldName), true, `Div must expose ${fieldName}`)
  }

  const manifest = compileSafeMaterialManifest({
    materialRegistryVersion: 1,
    metadata: { componentName: 'Div', configure },
  })
  const manifestFields = new Map(manifest.fields.map(field => [field.fieldId, field]))

  assert.equal(manifest.readiness.status, 'ready')
  assert.deepEqual(manifest.readiness.missingFieldIds, [])
  assert.deepEqual(manifest.readiness.unsupportedFieldIds, [])
  for (const fieldId of [
    'shared.title',
    'shared.rect',
    'shared.visibility',
    'props.background',
    'props.borderColor',
    'props.borderWidth',
    'props.borderRadius',
    'props.opacity',
    'props.overflow',
    'props.shadowColor',
    'props.shadowBlur',
    'props.shadowOffsetY',
    'div.panelShape',
    'div.panelInset',
    'div.visualPreset',
  ]) {
    assert.equal(manifestFields.get(fieldId)?.access, 'read-write', `${fieldId} must be writable`)
  }
  assert.equal(
    manifest.diagnostics.some(diagnostic => diagnostic.code === 'callback-annotation-required'),
    false,
  )
})

test('Div is registered in editor maps and the Document Executor bundle', () => {
  const componentRegistry = readFileSync(resolve(dashboardRoot, 'src/editor/materials/component.ts'), 'utf8')
  const metaRegistry = readFileSync(resolve(dashboardRoot, 'src/editor/materials/meta.ts'), 'utf8')
  const executorRegistry = readFileSync(
    resolve(dashboardRoot, '../../spikes/document-executor/harness/executor-materials.ts'),
    'utf8',
  )

  assert.match(componentRegistry, /inner\/div\/component/u)
  assert.match(componentRegistry, /\bDiv,/u)
  assert.match(metaRegistry, /inner\/div\/meta/u)
  assert.match(metaRegistry, /\bDiv,/u)
  assert.match(executorRegistry, /inner\/div\/component/u)
  assert.match(executorRegistry, /inner\/div\/meta/u)
  assert.match(executorRegistry, /\{ component: Div, meta: DivMeta \}/u)
})
