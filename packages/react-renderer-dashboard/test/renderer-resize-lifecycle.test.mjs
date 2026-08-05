import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'

const rendererSource = new URL('../src/renderer/index.tsx', import.meta.url)

test('dashboard renderer ignores a delayed resize callback after unmount', async () => {
  const source = await readFile(rendererSource, 'utf8')

  assert.match(source, /const viewportElement = viewportRef\.current\s+if \(!viewportElement\) return/)
  assert.doesNotMatch(source, /viewportRef\.current!\.style/)
})
