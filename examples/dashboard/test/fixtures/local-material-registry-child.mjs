import { createFileMaterialRegistry } from '../../server/promotion/file-material-registry.mjs'

const config = JSON.parse(process.env.EASY_EDITOR_REGISTRY_CHILD_CONFIG ?? '{}')

const checkpoint = async event => {
  const normalized = typeof event === 'string' ? { name: event } : event
  if (normalized?.name !== config.pauseAtCheckpoint) return
  process.send?.({ type: 'checkpoint', checkpoint: normalized })
  await new Promise(() => {})
}

try {
  const registry = await createFileMaterialRegistry({
    rootDir: config.rootDir,
    workspaceRoot: config.workspaceRoot,
    lease: config.lease,
    checkpoint,
  })
  let result
  switch (config.action) {
    case 'stage':
      result = await registry.stagePromotion(config.request)
      break
    case 'publish':
      result = await registry.publishPromotion({ promotionId: config.promotionId })
      break
    case 'stage-and-publish':
      await registry.stagePromotion(config.request)
      result = await registry.publishPromotion({ promotionId: config.request.promotionId })
      break
    case 'sweep':
      result = await registry.sweepGarbageCollection(config.plan)
      break
    default:
      throw new Error(`unsupported child action: ${config.action}`)
  }
  process.send?.({ type: 'result', result })
} catch (error) {
  process.send?.({
    type: 'error',
    error: {
      code: error?.code,
      message: error instanceof Error ? error.message : String(error),
    },
  })
  process.exitCode = 2
}
