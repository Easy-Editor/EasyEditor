import { parentPort } from 'node:worker_threads'
import { connectAgentPort } from '../../dist/index.js'

parentPort.once('message', async ({ documentId, port }) => {
  try {
    const capability = await connectAgentPort(port)
    capability.subscribe(event => parentPort.postMessage({ event, kind: 'event' }))
    const snapshot = await capability.snapshot(documentId)
    const preview = await capability.preview({
      documentId,
      baseRevision: snapshot.revision,
      commands: [
        {
          type: 'updateProps',
          nodeId: snapshot.schema.id,
          props: { title: 'from-real-worker' },
        },
      ],
    })
    const receipt = await capability.execute(preview.planId)
    parentPort.postMessage({
      descriptor: capability.descriptor,
      kind: 'receipt',
      receipt,
      snapshot,
    })
  } catch (error) {
    parentPort.postMessage({
      error: {
        code: error?.code,
        message: error instanceof Error ? error.message : String(error),
        name: error?.name,
      },
      kind: 'error',
    })
  }
})
