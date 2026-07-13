import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const readSource = relativePath => readFileSync(new URL(relativePath, import.meta.url), 'utf8')

test('DesignerView owns the instance clipboard injection lifecycle', () => {
  const source = readSource('../src/simulator-renderer/SimulatorRenderer/DesignView.tsx')
  const coreImport = source.match(/import\s+(?:type\s+)?{([\s\S]*?)}\s*from\s*['"]@easy-editor\/core\/instance['"]/)

  assert.ok(coreImport, 'expected a named @easy-editor/core/instance import')
  assert.doesNotMatch(coreImport[1], /(^|,)\s*clipboard\s*(,|$)/)
  assert.match(source, /designer\.editor\.get<Clipboard>\(['"]clipboard['"]\)/)

  const injectedDisposer = source.match(/const\s+(\w+)\s*=\s*\w+\.injectCopyPaster\(document\)/)
  assert.ok(injectedDisposer, 'expected the clipboard injection disposer to be retained')
  assert.match(source, new RegExp(`catch\\s*\\([^)]*\\)\\s*{[\\s\\S]*?${injectedDisposer[1]}\\(\\)[\\s\\S]*?throw`))
  assert.match(source, new RegExp(`return\\s*\\(\\)\\s*=>\\s*{[\\s\\S]*?${injectedDisposer[1]}\\(\\)`))
})

test('ProjectView reads loading configuration from its designer instance', () => {
  const source = readSource('../src/simulator-renderer/SimulatorRenderer/ProjectView.tsx')
  const coreImport = source.match(/import\s+(?:type\s+)?{([\s\S]*?)}\s*from\s*['"]@easy-editor\/core\/instance['"]/)

  assert.ok(coreImport, 'expected a named @easy-editor/core/instance import')
  assert.doesNotMatch(coreImport[1], /(^|,)\s*config\s*(,|$)/)
  assert.match(source, /designer\.editor\.engineConfig\.get\(['"]loadingComponent['"],\s*BuiltinLoading\)/)
})

test('each Canvas owns and disposes its own simulator renderer container', () => {
  const source = readSource('../src/simulator-renderer/SimulatorRenderer/SimulatorView.tsx')

  assert.match(source, /useState\(\(\)\s*=>\s*new SimulatorRendererContainer\(\)\)/)
  assert.match(source, /renderer\.mount\(host\)/)
  assert.match(source, /return\s*\(\)\s*=>\s*renderer\.dispose\(\)/)
  assert.doesNotMatch(source, /import\s*{[^}]*\bsimulatorRenderer\b[^}]*}/)
})
