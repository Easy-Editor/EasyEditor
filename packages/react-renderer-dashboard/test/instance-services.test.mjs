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
  assert.doesNotMatch(source, /\b(?:propsDesigner|designer)\.purge\s*\(/)
  assert.doesNotMatch(source, /nextProps\.designer\.setProps/)
  assert.match(source, /\['disposing', 'disposed', 'failed'\]\.includes\(lifecycleState/)
  assert.match(source, /designer\.setProps\(designerProps\)/)
})

test('ProjectView reads loading configuration from its designer instance', () => {
  const source = readSource('../src/simulator-renderer/SimulatorRenderer/ProjectView.tsx')
  const coreImport = source.match(/import\s+(?:type\s+)?{([\s\S]*?)}\s*from\s*['"]@easy-editor\/core\/instance['"]/)

  assert.ok(coreImport, 'expected a named @easy-editor/core/instance import')
  assert.doesNotMatch(coreImport[1], /(^|,)\s*config\s*(,|$)/)
  assert.match(source, /designer\.editor\.engineConfig\.get\(['"]loadingComponent['"],\s*BuiltinLoading\)/)
})

test('dashboard overlays stop reading plugin helpers after their Simulator generation is disposed', () => {
  const guideLineSource = readSource('../src/simulator-renderer/SimulatorRenderer/BemTools/GuideLine/index.tsx')
  const marqueeSource = readSource('../src/simulator-renderer/SimulatorRenderer/BemTools/MarqueeSelection/index.tsx')

  assert.match(guideLineSource, /host\.isDisposed\s*\?\s*null\s*:\s*host\.designer\.guideline/)
  assert.match(marqueeSource, /host\.isDisposed\s*\?\s*null\s*:\s*designer\.marqueeSelection/)
})

test('each Canvas owns and disposes its own simulator renderer container', () => {
  const source = readSource('../src/simulator-renderer/SimulatorRenderer/SimulatorView.tsx')

  assert.match(source, /useState\(\(\)\s*=>\s*new SimulatorRendererContainer\(\)\)/)
  assert.match(source, /renderer\.mount\(host\)/)
  assert.match(source, /return\s*\(\)\s*=>\s*renderer\.dispose\(\)/)
  assert.doesNotMatch(source, /import\s*{[^}]*\bsimulatorRenderer\b[^}]*}/)
})

test('the dashboard renderer composes a local adapter without module mutation side effects', () => {
  const source = readSource('../src/renderer-core/renderer.ts')

  assert.match(source, /createRendererAdapter\(/)
  assert.doesNotMatch(source, /import\s*{[^}]*\badapter\b[^}]*}/)
})

test('the package does not publish a shared simulator renderer container', () => {
  const packageEntry = readSource('../src/index.ts')
  const simulatorSource = readSource('../src/simulator-renderer/simulator-renderer.ts')

  assert.doesNotMatch(packageEntry, /\bsimulatorRenderer\b/)
  assert.doesNotMatch(simulatorSource, /export\s+const\s+simulatorRenderer\b/)
})

test('the simulator renderer propagates the instance-owned expression policy explicitly', () => {
  const simulatorSource = readSource('../src/simulator-renderer/simulator-renderer.ts')
  const rendererViewSource = readSource('../src/simulator-renderer/RendererView.tsx')

  assert.match(simulatorSource, /this\.host\.appHelper/)
  assert.match(rendererViewSource, /expressionEvaluator=\{container\.context\.expressionEvaluator\}/)
})

test('dashboard fault rendering remains fail-soft when no schema reaches the error boundary', () => {
  const faultSource = readSource('../src/renderer-core/components/DashboardFaultComponent.tsx')
  const wrapperSource = readSource('../src/renderer-core/components/DashboardWrapper.tsx')

  assert.match(faultSource, /props\.schema\s*\?\?\s*props\.__schema/)
  assert.match(faultSource, /if\s*\(!schema\)\s*return\s*<FaultComponent/)
  assert.match(wrapperSource, /if\s*\(!node\)\s*return\s+undefined/)
})
