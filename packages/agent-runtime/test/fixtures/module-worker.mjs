import { pathToFileURL } from 'node:url'
import { parentPort, workerData } from 'node:worker_threads'

try {
  const bootstrap = await import(pathToFileURL(`${workerData.emittedRoot}/internal/worker-bootstrap/index.js`).href)
  const testing = await import(pathToFileURL(`${workerData.emittedRoot}/internal/testing/scripted-model.js`).href)
  const fixtures = await import(
    pathToFileURL(`${workerData.emittedRoot}/internal/testing/deterministic-fixtures.js`).href
  )
  bootstrap.startAgentWorkerInternal({
    port: workerData.port,
    model: new testing.ScriptedModelAdapter(workerData.steps),
    clock: fixtures.createDeterministicClock(),
    idFactory: fixtures.createDeterministicIdFactory(),
  })
  parentPort.postMessage({ kind: 'ready' })
} catch (error) {
  parentPort.postMessage({ kind: 'error', message: error instanceof Error ? error.stack : String(error) })
}
