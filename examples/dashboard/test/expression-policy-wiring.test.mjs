import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const readSource = relativePath => readFile(new URL(relativePath, import.meta.url), 'utf8')

test('editor and direct preview explicitly share the side-effect-free expression policy', async () => {
  const [policy, editor, preview] = await Promise.all([
    readSource('../src/editor/expression-policy.ts'),
    readSource('../src/editor/index.ts'),
    readSource('../src/pages/preview/index.tsx'),
  ])

  assert.match(policy, /legacyTrustedExpressionEvaluator/)
  assert.doesNotMatch(policy, /createEngine|\.\/runtime/)
  assert.match(editor, /appHelper:\s*\{\s*expressionEvaluator:\s*dashboardExpressionEvaluator,/)
  assert.match(
    editor,
    /\.\.\.\(dashboardOnlineComponentSurfaceBridge\s*\?\s*\{\s*\[DASHBOARD_ONLINE_COMPONENT_BRIDGE_KEY\]:\s*dashboardOnlineComponentSurfaceBridge\s*\}\s*:\s*\{\}\s*\)/,
  )
  assert.match(preview, /expressionEvaluator=\{dashboardExpressionEvaluator\}/)
})
