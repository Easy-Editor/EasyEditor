import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')

test('hotkey actions use the plugin context clipboard instead of the legacy facade', () => {
  const coreImport = source.match(/import\s*{([\s\S]*?)}\s*from\s*['"]@easy-editor\/core\/instance['"]/)

  assert.ok(coreImport, 'expected a named @easy-editor/core/instance import')
  assert.doesNotMatch(source, /from\s*['"]@easy-editor\/core['"]/)
  assert.doesNotMatch(coreImport[1], /(^|,)\s*clipboard\s*(,|$)/)
  assert.match(source, /const\s*{[^}]*\bclipboard\b[^}]*}\s*=\s*ctx/)
  assert.match(source, /clipboard\.setData\(data\)/)
  assert.match(source, /clipboard\.waitPasteData\(/)
})

test('hotkey bindings are engine-owned leases instead of destroy-time capability calls', () => {
  assert.match(source, /hotkey\.acquireBinding\(keys, handler\)/)
  assert.match(source, /ctx\.onDispose\(release\)/)
  assert.match(source, /release\(\)/)
  assert.doesNotMatch(source, /hotkey\.unbind/)
  assert.doesNotMatch(source, /destroy\(ctx\)/)
})
