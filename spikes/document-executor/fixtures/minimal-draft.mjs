import { createHash } from 'node:crypto'

import { computeWorkspaceArtifactCompatibility } from '../src/workspace-artifacts.mjs'

export const FIXTURE_MATERIAL_MANIFEST = Object.freeze({
  version: '1',
  sha256: '039e9c858b4264d266bc0af14bd01c4861d27c74511548d19eb9ebc9886645ec',
})

const canonicalJson = value => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  return `{${Object.keys(value)
    .sort()
    .map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
    .join(',')}}`
}

const descriptor = schema => {
  const serialized = canonicalJson(schema)
  return {
    schema,
    bytes: Buffer.byteLength(serialized, 'utf8'),
    sha256: createHash('sha256').update(serialized).digest('hex'),
  }
}

export const createMinimalStoredProject = (suffix = 'default') => ({
  formatVersion: 1,
  editorSchema: {
    version: '1.0.0',
    componentsMap: [
      { devMode: 'lowCode', componentName: 'Root', version: 'workspace' },
      { devMode: 'lowCode', componentName: 'Text', version: 'workspace' },
    ],
    componentsTree: [
      {
        id: `document-executor-root-${suffix}`,
        docId: `document-executor-page-${suffix}`,
        fileName: 'home',
        componentName: 'Root',
        isRoot: true,
        props: {
          backgroundColor: '#101828',
        },
        $dashboard: {
          rect: { x: 0, y: 0, width: 1920, height: 1080 },
        },
        children: [
          {
            id: `document-executor-title-${suffix}`,
            componentName: 'Text',
            title: 'Document Executor title',
            props: {
              text: 'Before executor',
              style: {
                color: '#ffffff',
                fontSize: '36px',
              },
            },
            $dashboard: {
              rect: { x: 120, y: 80, width: 720, height: 80 },
            },
            children: [],
          },
        ],
      },
    ],
  },
  presentation: {
    startPageId: `document-executor-page-${suffix}`,
    theme: {
      mode: 'dark',
      tokens: { accent: '#60a5fa' },
    },
  },
  futureEnvelopeField: {
    sentinel: `preserve-${suffix}`,
    nested: { enabled: true },
  },
})

export const createMinimalPrepareInput = async (suffix = 'default') => {
  const projectId = `document-executor-project-${suffix}`
  return {
    contractVersion: 'easy-dashboard.executor.v1',
    executorId: 'document-executor-spike',
    operationId: `operation-${suffix}`,
    projectId,
    actorId: `actor-${suffix}`,
    taskId: `task-${suffix}`,
    stageId: `stage-${suffix}`,
    baseDraftVersion: 1,
    compatibility: await computeWorkspaceArtifactCompatibility({
      materialManifestVersion: FIXTURE_MATERIAL_MANIFEST.version,
      materialManifestSha256: FIXTURE_MATERIAL_MANIFEST.sha256,
    }),
    baseProject: descriptor(createMinimalStoredProject(suffix)),
    invocation: {
      sessionId: `session-${suffix}`,
      stepId: `step-${suffix}`,
      callId: `call-${suffix}`,
      capability: 'screen.applyChangeSet',
      arguments: {
        schemaVersion: 1,
        documentId: `document-executor-page-${suffix}`,
        operations: [
          {
            opId: `set-title-${suffix}`,
            type: 'set',
            nodeId: `document-executor-title-${suffix}`,
            fieldId: 'props.text',
            value: `After executor ${suffix}`,
          },
        ],
      },
    },
  }
}

export const createMinimalExecutionInput = async ({ suffix = 'default', seams } = {}) => ({
  grantToken: `grant-document-executor-${suffix}`,
  prepareInput: await createMinimalPrepareInput(suffix),
  ...(seams ? { seams } : {}),
})
