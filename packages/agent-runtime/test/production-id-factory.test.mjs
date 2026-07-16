import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const factorySourcePath = fileURLToPath(new URL('../src/internal/production-id-factory.ts', import.meta.url))

const loadFactoryModule = (runtimeGlobal = globalThis) => {
  const output = ts.transpileModule(readFileSync(factorySourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: factorySourcePath,
  }).outputText
  const loaded = { exports: {} }
  const evaluate = new Function('module', 'exports', 'globalThis', output)
  evaluate(loaded, loaded.exports, runtimeGlobal)
  return loaded.exports
}

test('production factories share a realm-wide collision-resistant sequence across independent instances', () => {
  const { createProductionIdFactory } = loadFactoryModule()
  const factories = Array.from({ length: 16 }, () => createProductionIdFactory())
  const kinds = ['session', 'task', 'step', 'call', 'message', 'request', 'batch']
  const ids = factories.flatMap(factory => kinds.map(kind => factory.next(kind)))

  assert.equal(new Set(ids).size, ids.length)
  ids.forEach((id, index) =>
    assert.match(id, new RegExp(`^${kinds[index % kinds.length]}-[0-9a-f]{32}-[0-9a-z]+$`, 'u')),
  )
})

test('production identity generation fails closed when secure randomness is unavailable', () => {
  const { createProductionIdFactory } = loadFactoryModule({ crypto: undefined })
  assert.throws(() => createProductionIdFactory().next('session'), /requires cryptographically secure random values/u)
})

test('independent module lifetimes use distinct realm entropy and both production entry paths consume the shared factory', () => {
  const first = loadFactoryModule().createProductionIdFactory().next('session')
  const second = loadFactoryModule().createProductionIdFactory().next('session')
  assert.notEqual(first, second)

  for (const relativePath of ['src/internal/runtime/runtime.ts', 'src/internal/worker-bootstrap/worker-bootstrap.ts']) {
    const source = readFileSync(`${packageRoot}/${relativePath}`, 'utf8')
    assert.match(source, /options\.idFactory \?\? createProductionIdFactory\(\)/u)
    assert.doesNotMatch(source, /const createIdFactory/u)
  }
})
