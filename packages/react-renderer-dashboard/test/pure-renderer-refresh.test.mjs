import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../src/renderer/pure/index.tsx', import.meta.url), 'utf8')

test('keeps the last rendered page visible while a newer schema is prepared', () => {
  assert.match(source, /if \(loading && !schema\)/)
  assert.doesNotMatch(source, /if \(loading\) \{\s*return/)
  assert.match(source, /const \[activeRendererProps, setActiveRendererProps\] = useState\(rendererProps\)/)
  assert.match(source, /setSchema\(pageSchema\)\s+setActiveRendererProps\(rendererPropsRef\.current\)/)
  assert.match(source, /<Renderer\s+\{\.\.\.activeRendererProps\}/)
})
