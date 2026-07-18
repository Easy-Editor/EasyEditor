import { createHash } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

import { verifyArtifactRecordIntegrity } from '../../src/lib/storage/artifact-contracts.mjs'
import { checkEasypackRuntimeReadiness, loadEasypackRuntime } from './easypack-runtime-loader.mjs'
import { promotionError, throwIfPromotionAborted } from './promotion-error.mjs'
import { validateMaterialPromotionCall } from './request-contract.mjs'

const EASYPACK_ENTRY_FILE = 'dist/index.esm.js'

const sha256 = value => `sha256:${createHash('sha256').update(value).digest('hex')}`
const hashBytes = bytes => createHash('sha256').update(bytes).digest()

const isInside = (root, candidate) => {
  const pathFromRoot = relative(root, candidate)
  return (
    pathFromRoot === '' || (!isAbsolute(pathFromRoot) && pathFromRoot !== '..' && !pathFromRoot.startsWith(`..${sep}`))
  )
}

const requireNodeMajor = version => {
  const match = String(version).match(/^(?:v)?(\d+)/u)
  return match ? Number.parseInt(match[1], 10) : 0
}

const packageSlug = logicalComponentId => {
  const value = logicalComponentId
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, '-')
    .replace(/^[^a-z0-9]+/u, '')
    .replace(/-+$/u, '')
    .slice(0, 96)
  return value || sha256(logicalComponentId).slice('sha256:'.length, 'sha256:'.length + 16)
}

const packageVersion = sourceRevision => {
  const value = sourceRevision
    .replace(/[^0-9A-Za-z.-]+/gu, '-')
    .replaceAll('.', '-')
    .replace(/^[.-]+|[.-]+$/gu, '')
    .slice(0, 64)
  const suffix = sha256(sourceRevision).slice('sha256:'.length, 'sha256:'.length + 16)
  return `0.0.0-rev-${value || 'source'}-${suffix}`
}

const sourceRevisionOf = artifact => ({
  artifactId: artifact.artifactId,
  sourceRevision: artifact.sourceRevision,
  logicalComponentId: artifact.logicalComponentId,
  sourceIntegrity: artifact.sourceIntegrity,
})

const trustedWrapperSource = artifact => {
  const descriptor = {
    schemaVersion: 1,
    componentName: 'GeneratedMaterialHost',
    runtime: 'sandbox-proxy',
    sourceRevision: sourceRevisionOf(artifact),
    dependencyLockDigest: artifact.dependencyLockDigest,
  }
  return [
    `export const generatedMaterialDescriptor = Object.freeze(${JSON.stringify(descriptor)})`,
    "export const componentName = 'GeneratedMaterialHost'",
    "export const runtime = 'sandbox-proxy'",
    'export default generatedMaterialDescriptor',
    '',
  ].join('\n')
}

const normalizeArtifactFiles = async (buildDirectory, buildResult) => {
  if (!buildResult || !Array.isArray(buildResult.artifacts)) {
    throw promotionError('promotion-build-invalid', 503, 'Easypack returned an invalid build result')
  }
  const files = []
  const paths = new Set()
  for (const artifact of buildResult.artifacts) {
    if (
      !artifact ||
      typeof artifact.path !== 'string' ||
      artifact.path.includes('\\') ||
      artifact.path.includes('\0') ||
      isAbsolute(artifact.path) ||
      artifact.path.split('/').some(segment => segment === '' || segment === '.' || segment === '..') ||
      paths.has(artifact.path)
    ) {
      throw promotionError('promotion-build-invalid', 503, 'Easypack returned an invalid build artifact')
    }
    const outputPath = resolve(buildDirectory, ...artifact.path.split('/'))
    if (!isInside(buildDirectory, outputPath)) {
      throw promotionError('path-escape', 400, 'Build artifact escaped its trusted workspace')
    }
    const stats = await lstat(outputPath)
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw promotionError('promotion-build-invalid', 503, 'Easypack build artifact is not a regular file')
    }
    const bytes = await readFile(outputPath)
    paths.add(artifact.path)
    files.push({ path: artifact.path, byteLength: bytes.byteLength, integrity: sha256(bytes) })
  }
  files.sort((left, right) => left.path.localeCompare(right.path))
  if (!paths.has(EASYPACK_ENTRY_FILE)) {
    throw promotionError('promotion-build-invalid', 503, 'Easypack did not produce the trusted wrapper entry')
  }
  return files
}

export const createEasypackTrustedWrapperAuthor = ({
  workspaceRoot,
  nodeVersion = process.versions.node,
  loadEasypack = loadEasypackRuntime,
  now,
} = {}) => {
  if (typeof workspaceRoot !== 'string' || workspaceRoot.length === 0 || workspaceRoot.includes('\0')) {
    throw new TypeError('workspaceRoot must be a non-empty filesystem path')
  }
  if (typeof loadEasypack !== 'function') throw new TypeError('loadEasypack must be a function')
  if (now !== undefined && typeof now !== 'function') throw new TypeError('now must be a function')
  const resolvedWorkspaceRoot = resolve(workspaceRoot)
  const nodeMajor = requireNodeMajor(nodeVersion)

  return Object.freeze({
    async checkAvailability() {
      if (nodeMajor < 20) {
        return Object.freeze({
          schemaVersion: 1,
          available: false,
          reason: 'node-version',
          minimumNodeMajor: 20,
        })
      }
      const available = loadEasypack === loadEasypackRuntime ? await checkEasypackRuntimeReadiness() : true
      return Object.freeze({
        schemaVersion: 1,
        available,
        reason: available ? 'ready' : 'easypack-unavailable',
        minimumNodeMajor: 20,
      })
    },
    async authorPromotion({ principal, request, signal } = {}) {
      if (nodeMajor < 20) {
        throw promotionError('promotion-runtime-unavailable', 503, 'Local material promotion requires Node 20 or newer')
      }
      if (
        !principal ||
        typeof principal !== 'object' ||
        Array.isArray(principal) ||
        typeof principal.tenantId !== 'string' ||
        typeof principal.userId !== 'string'
      ) {
        throw promotionError('unauthorized', 403, 'Request is not authorized')
      }
      throwIfPromotionAborted(signal)
      let promotionRequest
      try {
        promotionRequest = validateMaterialPromotionCall(request)
      } catch {
        throw promotionError('invalid-request', 400, 'Request is invalid')
      }

      let artifact
      try {
        throwIfPromotionAborted(signal)
        artifact = await verifyArtifactRecordIntegrity(promotionRequest.artifact, { hashBytes })
        throwIfPromotionAborted(signal)
      } catch {
        throwIfPromotionAborted(signal)
        throw promotionError('artifact-integrity-mismatch', 409, 'Artifact integrity verification failed')
      }

      throwIfPromotionAborted(signal)
      await mkdir(resolvedWorkspaceRoot, { recursive: true })
      const buildDirectory = await mkdtemp(join(resolvedWorkspaceRoot, 'promotion-'))
      if (!isInside(resolvedWorkspaceRoot, buildDirectory)) {
        throw promotionError('path-escape', 400, 'Promotion workspace escaped its configured root')
      }
      try {
        throwIfPromotionAborted(signal)
        await mkdir(join(buildDirectory, 'src'))
        const packageManifest = {
          name: `@easy-editor/local-material-${packageSlug(artifact.logicalComponentId)}`,
          version: packageVersion(artifact.sourceRevision),
          private: true,
          type: 'module',
        }
        await Promise.all([
          writeFile(join(buildDirectory, 'package.json'), `${JSON.stringify(packageManifest, null, 2)}\n`),
          writeFile(join(buildDirectory, 'src/index.mjs'), trustedWrapperSource(artifact)),
        ])

        let easypack
        try {
          easypack = await loadEasypack({ signal })
          throwIfPromotionAborted(signal)
        } catch {
          throwIfPromotionAborted(signal)
          throw promotionError('promotion-runtime-unavailable', 503, 'Local material promotion is unavailable')
        }
        if (typeof easypack?.buildEasypack !== 'function') {
          throw promotionError('promotion-runtime-unavailable', 503, 'Local material promotion is unavailable')
        }
        let easypackResult
        try {
          throwIfPromotionAborted(signal)
          easypackResult = await easypack.buildEasypack({
            rootDir: buildDirectory,
            config: {
              preset: 'library',
              entry: { main: 'src/index.mjs' },
              output: {
                dir: 'dist',
                esm: true,
                cjs: false,
                umd: false,
                minify: false,
                sourcemap: false,
                types: false,
              },
            },
          })
          throwIfPromotionAborted(signal)
        } catch (error) {
          throwIfPromotionAborted(signal)
          if (error?.code && error?.status) throw error
          throw promotionError('promotion-build-failed', 503, 'Easypack failed to author the trusted wrapper', true)
        }

        // The build metadata selects outputs, while sizes and digests are recomputed from confined files.
        const files = await normalizeArtifactFiles(buildDirectory, easypackResult)
        throwIfPromotionAborted(signal)
        const entry = files.find(file => file.path === EASYPACK_ENTRY_FILE)
        const createdAt = now ? now() : artifact.createdAt
        if (!Number.isSafeInteger(createdAt) || createdAt < 0) {
          throw promotionError('promotion-build-invalid', 503, 'Promotion clock returned an invalid timestamp')
        }
        return Object.freeze({
          schemaVersion: 1,
          promotionId: promotionRequest.promotionId,
          projectId: promotionRequest.projectId,
          materialId: artifact.logicalComponentId,
          materialVersion: artifact.sourceRevision,
          logicalComponentId: artifact.logicalComponentId,
          buildIntegrity: entry.integrity,
          sourceRevision: Object.freeze(sourceRevisionOf(artifact)),
          dependencyLockDigest: artifact.dependencyLockDigest,
          entryFile: EASYPACK_ENTRY_FILE,
          buildDirectory,
          files: Object.freeze(files.map(file => Object.freeze(file))),
          createdAt,
        })
      } catch (error) {
        await rm(buildDirectory, { force: true, recursive: true }).catch(() => undefined)
        throw error
      }
    },
    async releasePromotion({ buildDirectory } = {}) {
      if (typeof buildDirectory !== 'string') return
      const resolvedBuildDirectory = resolve(buildDirectory)
      if (
        !isInside(resolvedWorkspaceRoot, resolvedBuildDirectory) ||
        resolvedBuildDirectory === resolvedWorkspaceRoot
      ) {
        throw promotionError('path-escape', 400, 'Promotion workspace escaped its configured root')
      }
      await rm(resolvedBuildDirectory, { force: true, recursive: true })
    },
  })
}
