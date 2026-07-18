import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const packageRoot = fileURLToPath(new URL('..', import.meta.url))
const require = createRequire(import.meta.url)

const readEntry = relativePath => {
  const configPath = path.join(packageRoot, 'tsconfig.build.json')
  const config = ts.readConfigFile(configPath, ts.sys.readFile)
  assert.equal(config.error, undefined)
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, packageRoot)
  const program = ts.createProgram({ options: { ...parsed.options, noEmit: true }, rootNames: parsed.fileNames })
  const checker = program.getTypeChecker()
  const source = program.getSourceFile(path.join(packageRoot, relativePath))
  assert.ok(source, `${relativePath} must be part of the package build`)
  const moduleSymbol = checker.getSymbolAtLocation(source)
  assert.ok(moduleSymbol)
  const exports = checker.getExportsOfModule(moduleSymbol)
  const resolve = symbol => (symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol)
  return {
    all: exports.map(symbol => symbol.name).sort(),
    runtime: exports
      .filter(symbol => resolve(symbol).flags & ts.SymbolFlags.Value)
      .map(symbol => symbol.name)
      .sort(),
  }
}

test('source entries expose finite profile-specific APIs', () => {
  const root = readEntry('src/index.ts')
  const worker = readEntry('src/worker.ts')
  const testing = readEntry('src/testing.ts')

  assert.deepEqual(root.runtime, ['createAgentRuntime'])
  for (const name of [
    'AgentRuntime',
    'AgentWorkerEndpoint',
    'AgentHost',
    'AgentPersistencePort',
    'HostInvocationContextV1',
    'RuntimeTaskCompensationTargetV1',
    'JsonValue',
  ]) {
    assert.ok(root.all.includes(name), `root entry must export ${name}`)
  }
  for (const name of [
    'ModelAdapter',
    'AgentWorkerOptions',
    'startAgentWorker',
    'ScriptedModelAdapter',
    'createWorkerStateMachine',
    'parseModelEvent',
    'parseProtocolEnvelope',
    'WorkerTelemetrySink',
    'createWorkerTelemetryLedger',
  ]) {
    assert.equal(root.all.includes(name), false, `root entry must not export ${name}`)
  }

  assert.deepEqual(worker, {
    all: [
      'AgentSessionContextBudget',
      'AgentSessionContextDigest',
      'AgentSessionContextSourceRange',
      'AgentSessionTaskExcerpt',
      'AgentSessionUnresolvedConstraint',
      'AgentSessionUnresolvedConstraintKind',
      'AgentWorkerOptions',
      'Clock',
      'IdFactory',
      'ModelAdapter',
      'ModelEvent',
      'ModelTurnPhase',
      'ModelTurnRequest',
      'WORKER_TELEMETRY_SCHEMA_VERSION',
      'WorkerTelemetryEvent',
      'WorkerTelemetryEventType',
      'WorkerTelemetryLedger',
      'WorkerTelemetrySink',
      'WorkerTelemetryStatus',
      'createWorkerTelemetryEvent',
      'createWorkerTelemetryLedger',
      'startAgentWorker',
      'workerTelemetryEventTypes',
    ],
    runtime: [
      'WORKER_TELEMETRY_SCHEMA_VERSION',
      'createWorkerTelemetryEvent',
      'createWorkerTelemetryLedger',
      'startAgentWorker',
      'workerTelemetryEventTypes',
    ],
  })
  assert.deepEqual(testing, {
    all: [
      'DeterministicClock',
      'DeterministicIdFactory',
      'FakeAgentHost',
      'FakeAgentHostOptions',
      'FakeInvocationStep',
      'MemoryAgentPersistence',
      'ScriptedModelAdapter',
      'ScriptedModelAdapterOptions',
      'ScriptedModelFault',
      'ScriptedModelStep',
      'createDeterministicClock',
      'createDeterministicIdFactory',
    ],
    runtime: [
      'DeterministicClock',
      'DeterministicIdFactory',
      'FakeAgentHost',
      'MemoryAgentPersistence',
      'ScriptedModelAdapter',
      'createDeterministicClock',
      'createDeterministicIdFactory',
    ],
  })
})

test('publish entries mirror runtime exports and keep the model stack out of root', async () => {
  const expected = {
    index: ['createAgentRuntime'],
    worker: [
      'WORKER_TELEMETRY_SCHEMA_VERSION',
      'createWorkerTelemetryEvent',
      'createWorkerTelemetryLedger',
      'startAgentWorker',
      'workerTelemetryEventTypes',
    ],
    testing: [
      'DeterministicClock',
      'DeterministicIdFactory',
      'FakeAgentHost',
      'MemoryAgentPersistence',
      'ScriptedModelAdapter',
      'createDeterministicClock',
      'createDeterministicIdFactory',
    ],
  }

  for (const [entry, names] of Object.entries(expected)) {
    const esm = await import(`${pathToFileURL(path.join(packageRoot, `dist/${entry}.js`)).href}?test=${Date.now()}`)
    const cjs = require(path.join(packageRoot, `dist/${entry}.cjs`))
    assert.deepEqual(Object.keys(esm).sort(), names)
    assert.deepEqual(Object.keys(cjs).sort(), names)
  }

  const rootBundles = ['dist/index.js', 'dist/index.cjs'].map(file =>
    readFileSync(path.join(packageRoot, file), 'utf8'),
  )
  for (const source of rootBundles) {
    for (const forbidden of [
      'createWorkerStateMachine',
      'parseModelEvent',
      'ScriptedModelAdapter',
      'startAgentWorker',
      'createWorkerTelemetryLedger',
    ]) {
      assert.doesNotMatch(source, new RegExp(forbidden), `root bundle must not include ${forbidden}`)
    }
  }
})
