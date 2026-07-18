import { createHash } from 'node:crypto'

import { createEasypackTrustedWrapperAuthor } from '../../server/promotion/easypack-author.mjs'
import { canonicalJsonStringify } from '../../src/lib/storage/canonical-json.mjs'

const config = JSON.parse(process.env.EASY_EDITOR_AUTHOR_CHILD_CONFIG ?? '{}')
const sha256 = value => `sha256:${createHash('sha256').update(value).digest('hex')}`
const digest = character => `sha256:${character.repeat(64)}`
const source = "export default { mount(root) { root.textContent = 'crash fixture' }, update() {}, destroy() {} }"
const lockedDependencies = Object.freeze([])
const dependencyLockDigest = sha256(canonicalJsonStringify(lockedDependencies))

const artifact = Object.freeze({
  schemaVersion: 1,
  projectId: 'project-author-crash',
  artifactId: 'artifact-author-crash',
  sourceRevision: 'source-author-crash-v1',
  logicalComponentId: 'logical-author-crash',
  sourceIntegrity: sha256(source),
  source,
  css: '',
  safeManifest: Object.freeze({ schemaVersion: 1, title: 'Crash fixture' }),
  lockedDependencies,
  dependencyLockDigest,
  diagnostics: Object.freeze([]),
  provenance: Object.freeze({ actor: 'author-crash-fixture' }),
  createdAt: 100,
  supersedes: null,
})

const request = {
  schemaVersion: 1,
  projectId: artifact.projectId,
  branchId: 'main',
  sessionId: 'session-author-crash',
  taskId: 'task-author-crash',
  stepId: 'step-author-crash',
  callId: 'call-author-crash',
  callDigest: digest('a'),
  artifact,
}
request.promotionId = sha256(
  canonicalJsonStringify({
    schemaVersion: 1,
    kind: 'local-material-promotion-identity',
    authority: {
      projectId: request.projectId,
      branchId: request.branchId,
      sessionId: request.sessionId,
      taskId: request.taskId,
    },
    callId: request.callId,
    callDigest: request.callDigest,
    artifact: {
      artifactId: artifact.artifactId,
      sourceRevision: artifact.sourceRevision,
      logicalComponentId: artifact.logicalComponentId,
      sourceIntegrity: artifact.sourceIntegrity,
      dependencyLockDigest: artifact.dependencyLockDigest,
    },
  }),
)

const author = createEasypackTrustedWrapperAuthor({
  workspaceRoot: config.workspaceRoot,
  nodeVersion: '20.0.0',
  async loadEasypack() {
    return {
      async buildEasypack({ rootDir }) {
        process.send?.({ type: 'workspace-ready', buildDirectory: rootDir })
        setInterval(() => undefined, 1_000)
        await new Promise(() => {})
      },
    }
  },
})

try {
  if (config.action === 'recover') {
    const recovered = await author.recoverPromotionWorkspaces()
    await author.dispose()
    process.send?.({ type: 'recovered', recovered })
  } else {
    await author.authorPromotion({
      principal: { tenantId: 'trusted-tenant', userId: 'trusted-user' },
      request,
    })
  }
} catch (error) {
  process.send?.({
    type: 'error',
    error: { code: error?.code, message: error instanceof Error ? error.message : String(error) },
  })
  process.exitCode = 2
}
