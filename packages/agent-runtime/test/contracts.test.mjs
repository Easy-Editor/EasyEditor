import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const contractPath = path.join(packageRoot, 'src/contracts.ts')

test('shared contracts remain type-only and expose the reviewed host seams', () => {
  const configPath = path.join(packageRoot, 'tsconfig.build.json')
  const config = ts.readConfigFile(configPath, ts.sys.readFile)
  assert.equal(config.error, undefined)

  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, packageRoot)
  const program = ts.createProgram({ options: { ...parsed.options, noEmit: true }, rootNames: parsed.fileNames })
  const diagnostics = ts.getPreEmitDiagnostics(program)
  assert.deepEqual(
    diagnostics.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')),
    [],
  )

  const source = program.getSourceFile(contractPath)
  assert.ok(source)
  const checker = program.getTypeChecker()
  const moduleSymbol = checker.getSymbolAtLocation(source)
  assert.ok(moduleSymbol)

  const exports = checker.getExportsOfModule(moduleSymbol)
  const runtimeExports = exports.filter(symbol => {
    const resolved = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
    return Boolean(resolved.flags & ts.SymbolFlags.Value)
  })
  assert.deepEqual(runtimeExports, [], 'foundation contracts must not ship runtime behavior')

  const names = new Set(exports.map(symbol => symbol.name))
  for (const required of [
    'AgentRuntime',
    'AgentRuntimeOptions',
    'AgentWorkerEndpoint',
    'AgentHost',
    'AgentPersistencePort',
    'ModelAdapter',
    'AgentWorkerOptions',
    'AgentRuntimeSnapshot',
    'SemanticCall',
    'HostInvocationContextV1',
    'RuntimeTaskCompensationTargetV1',
    'AgentPersistenceBatch',
    'JsonValue',
  ]) {
    assert.ok(names.has(required), `missing reviewed contract ${required}`)
  }
})

test('package publishes only the reviewed root, worker, and testing entries', () => {
  const manifest = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8'))
  assert.equal(manifest.name, '@easy-editor/agent-runtime')
  assert.equal(manifest.private, undefined)
  assert.deepEqual(manifest.exports, {
    '.': './src/index.ts',
    './worker': './src/worker.ts',
    './testing': './src/testing.ts',
  })
  assert.deepEqual(Object.keys(manifest.publishConfig.exports), ['.', './worker', './testing'])
})
