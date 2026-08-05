import { readFile, writeFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import process from 'node:process'

import { DocumentExecutorError, executeDocumentFromJson } from './executor.mjs'

const SAFE_FAILURE_MESSAGES = Object.freeze({
  BROWSER_STORAGE_ISOLATION_FAILED: 'Browser storage isolation verification failed',
  BROWSER_ARTIFACT_PROVENANCE_MISMATCH: 'Browser artifact provenance verification failed',
  BROWSER_ARTIFACT_MISMATCH: 'Browser artifact verification failed',
  CREDENTIAL_INPUT_FORBIDDEN: 'Executor input contains forbidden credentials',
  DOCUMENT_DESCRIPTOR_MISMATCH: 'Document descriptor verification failed',
  DURABLE_OUTCOME_MISMATCH: 'Durable outcome verification failed',
  DURABLE_OUTCOME_NOT_EXECUTABLE: 'Durable outcome forbids execution',
  FORCED_CRASH_AFTER_APPLY: 'Forced crash seam after Host invocation',
  FORCED_CRASH_AFTER_COMMIT_ACK: 'Forced crash seam after commit acknowledgement',
  FORCED_CRASH_AFTER_PREPARE: 'Forced crash seam after candidate preparation',
  HARNESS_E2E_BUILD_REQUIRED: 'Document Executor Harness is not an E2E build',
  INVALID_CONTRACT: 'Executor contract validation failed',
  INVALID_INPUT: 'Executor input validation failed',
  INVALID_OPERATOR_DASHBOARD_URL: 'Operator Dashboard URL is invalid',
  INVALID_TRANSPORT: 'Executor transport validation failed',
  MATERIAL_MANIFEST_MISMATCH: 'Material manifest verification failed',
  OPERATION_ORIGIN_FORBIDDEN: 'Operation input cannot select the Dashboard origin',
  SCREENSHOT_ARTIFACT_WRITE_FAILED: 'Screenshot artifact could not be written',
  TRANSPORT_FAILED: 'Executor transport failed',
  UNEXPECTED_BROWSER_ERROR: 'Document Executor Harness emitted a browser error',
  FORBIDDEN_BROWSER_RESOURCE_REQUEST: 'Document Executor Harness requested a forbidden resource',
  WORKSPACE_ARTIFACT_MISMATCH: 'Workspace artifact verification failed',
})

const safeFailureMessage = error =>
  error instanceof DocumentExecutorError
    ? error.code === 'TRANSPORT_FAILED'
      ? error.message
      : (SAFE_FAILURE_MESSAGES[error.code] ?? 'Document executor failed')
    : 'Document executor failed'

const readInput = async () => {
  const filename = process.argv[2]
  if (filename) return readFile(filename, 'utf8')
  const chunks = []
  for await (const chunk of process.stdin) chunks.push(chunk)
  return Buffer.concat(chunks).toString('utf8')
}

try {
  const screenshotArtifactPath = process.env.EASY_EDITOR_DOCUMENT_EXECUTOR_SCREENSHOT_PATH
  if (screenshotArtifactPath && !isAbsolute(screenshotArtifactPath)) {
    throw new DocumentExecutorError(
      'SCREENSHOT_ARTIFACT_WRITE_FAILED',
      'Screenshot artifact path must be absolute',
    )
  }
  const result = await executeDocumentFromJson(await readInput(), {
    ...(screenshotArtifactPath
      ? {
          onScreenshotArtifact: async artifact => {
            try {
              await writeFile(screenshotArtifactPath, artifact.bytes, { flag: 'wx', mode: 0o600 })
            } catch (error) {
              throw new DocumentExecutorError(
                'SCREENSHOT_ARTIFACT_WRITE_FAILED',
                'Screenshot artifact could not be written',
                { cause: error instanceof Error ? error.message : String(error) },
              )
            }
          },
        }
      : {}),
  })
  process.stdout.write(`${JSON.stringify(result)}\n`)
} catch (error) {
  if (process.env.EASY_EDITOR_DOCUMENT_EXECUTOR_DEBUG === '1') {
    process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`)
    if (error instanceof DocumentExecutorError && error.details && Object.keys(error.details).length > 0) {
      process.stderr.write(`${JSON.stringify(error.details)}\n`)
    }
  }
  const result = {
    schemaVersion: 1,
    status: 'failed',
    failure: {
      code: error instanceof DocumentExecutorError ? error.code : 'EXECUTOR_FAILED',
      message: safeFailureMessage(error),
    },
  }
  process.stdout.write(`${JSON.stringify(result)}\n`)
  process.exitCode = 1
}
