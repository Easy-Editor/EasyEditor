import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const readSource = relativePath => readFileSync(new URL(relativePath, import.meta.url), 'utf8')

const toolsCss = readSource('../src/simulator-renderer/SimulatorRenderer/BemTools/tools.css')
const detectingSource = readSource('../src/simulator-renderer/SimulatorRenderer/BemTools/BorderDetecting.tsx')
const selectingInstanceSource = readSource(
  '../src/simulator-renderer/SimulatorRenderer/BemTools/BorderSelecting/BorderSelectingInstance.tsx',
)
const selectingBoxSource = readSource(
  '../src/simulator-renderer/SimulatorRenderer/BemTools/BorderSelecting/BorderSelectingForBox.tsx',
)
const selectingNodeSource = readSource(
  '../src/simulator-renderer/SimulatorRenderer/BemTools/BorderSelecting/BorderSelectingForNode.tsx',
)
const resizingSource = readSource('../src/simulator-renderer/SimulatorRenderer/BemTools/BorderResizing/index.tsx')

test('precision canvas exposes distinct hover, selection, multi-selection, and locked states', () => {
  const detectingBlock = toolsCss.match(/\.lc-borders-detecting\s*{([^}]*)}/)?.[1] ?? ''

  assert.match(toolsCss, /\.lc-borders-detecting\s*{[\s\S]*?border-style:\s*dashed/)
  assert.match(toolsCss, /\.lc-borders-selecting\s*{[\s\S]*?border-style:\s*solid/)
  assert.match(toolsCss, /\.lc-borders-selecting\.multi-select\s*{[\s\S]*?border-style:\s*dashed/)
  assert.match(
    toolsCss,
    /\.lc-borders(?:-detecting|-selecting)\.locked\s*{[\s\S]*?border-color:\s*var\(--color-canvas-locked/,
  )
  assert.doesNotMatch(detectingBlock, /box-shadow:/)

  assert.match(detectingSource, /isLocked\s*\?\s*['"] locked['"]/)
  assert.match(selectingInstanceSource, /if\s*\(isLocked\)\s*{[\s\S]*?classname\s*\+=\s*['"] locked['"]/)
  assert.match(selectingBoxSource, /multi-select/)
  assert.match(selectingNodeSource, /isLocked=\{node\.isLocked\}/)
  assert.match(resizingSource, /nodes\.some\(node\s*=>\s*node\.isLocked\)/)
})

test('precision canvas resize handles use exact square geometry', () => {
  assert.match(toolsCss, /\.lc-resize-corner\s*{[\s\S]*?width:\s*7px;[\s\S]*?height:\s*7px;/)
  assert.match(toolsCss, /\.lc-resize-corner\s*{[\s\S]*?border-radius:\s*0;/)
  assert.match(toolsCss, /&\.e,[\s\S]*?&\.w\s*{[\s\S]*?&:after\s*{[\s\S]*?width:\s*4px;[\s\S]*?height:\s*14px;/)
  assert.match(toolsCss, /&\.n,[\s\S]*?&\.s\s*{[\s\S]*?&:after\s*{[\s\S]*?width:\s*14px;[\s\S]*?height:\s*4px;/)
})

test('precision canvas guides, distances, user guides, and marquee use the requested state palette', () => {
  assert.match(toolsCss, /\.lc-guideline\s*{[\s\S]*?var\(--color-canvas-guide,\s*#06b6d4\)/)
  assert.match(toolsCss, /\.lc-distance-segment\s*{[\s\S]*?var\(--color-canvas-guide,\s*#06b6d4\)/)
  assert.match(toolsCss, /\.lc-user-guideline::before\s*{[\s\S]*?var\(--color-canvas-user-guide,\s*#f59e0b\)/)
  assert.match(toolsCss, /\.lc-marquee-selection\s*{[\s\S]*?rgba\(37,\s*99,\s*235,\s*0\.06\)/)
})
