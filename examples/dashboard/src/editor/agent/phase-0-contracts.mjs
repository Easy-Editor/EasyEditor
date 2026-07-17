import {
  readCanonicalNodeArtifactRef,
  validateArtifactRef,
  writeCanonicalNodeArtifactRef,
} from '../../lib/storage/artifact-contracts.mjs'

export const GENERATED_MATERIAL_HOST_COMPONENT_NAME = 'GeneratedMaterialHost'

const toSourceRevision = artifactRef => ({
  artifactId: artifactRef.artifactId,
  sourceRevision: artifactRef.sourceRevision,
  logicalComponentId: artifactRef.logicalComponentId,
  sourceIntegrity: artifactRef.sourceIntegrity,
})

export const promoteArtifactRef = (onlineArtifactRef, target) => {
  const normalizedOnlineRef = validateArtifactRef(onlineArtifactRef)
  if (normalizedOnlineRef.target.kind !== 'online') {
    throw new TypeError('Only an online ArtifactRef can be promoted')
  }
  return validateArtifactRef({
    ...toSourceRevision(normalizedOnlineRef),
    target: { ...target },
    rollbackTo: toSourceRevision(normalizedOnlineRef),
  })
}

export const promoteGeneratedNodeArtifact = (binding, target) => {
  const artifactRef = readCanonicalNodeArtifactRef(binding)
  if (artifactRef === null) throw new TypeError('Generated material binding requires an ArtifactRef')
  return writeCanonicalNodeArtifactRef(
    { ...binding, componentName: GENERATED_MATERIAL_HOST_COMPONENT_NAME },
    promoteArtifactRef(artifactRef, target),
  )
}

export const defineConfigureAnnotationOverlay = overlay => overlay

/**
 * Phase 0 sidecar annotations for callback-backed Dashboard configure fields.
 * The existing Core Configure/FieldConfig objects remain unchanged.
 */
export const dashboardConfigureAnnotations = defineConfigureAnnotationOverlay({
  'shared.id': {
    fieldId: 'shared.id',
    access: 'read-only',
    readPath: ['node', 'id'],
    verifyPaths: [['node', 'id']],
  },
  'shared.title': {
    fieldId: 'shared.title',
    access: 'read-write',
    readPath: ['extra', 'title'],
    writeTargets: [{ path: ['extra', 'title'] }],
    unsetTargets: [{ path: ['extra', 'title'] }],
    valueSchema: { type: 'string' },
    verifyPaths: [['extra', 'title']],
  },
  'shared.rect': {
    fieldId: 'shared.rect',
    access: 'read-write',
    readPath: ['extra', '$dashboard', 'rect'],
    writeTargets: [{ path: ['extra', '$dashboard', 'rect'] }],
    unsetTargets: [{ path: ['extra', '$dashboard', 'rect'] }],
    valueSchema: {
      type: 'object',
      required: ['x', 'y', 'width', 'height'],
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number', minimum: 0 },
        height: { type: 'number', minimum: 0 },
      },
    },
    verifyPaths: [['extra', '$dashboard', 'rect']],
  },
  'shared.visibility': {
    fieldId: 'shared.visibility',
    access: 'read-write',
    readPath: ['extra', 'condition'],
    writeTargets: [{ path: ['extra', 'condition'] }],
    unsetTargets: [{ path: ['extra', 'condition'] }],
    valueSchema: { type: 'boolean' },
    verifyPaths: [['extra', 'condition']],
  },
  dataSources: {
    fieldId: 'dataSources',
    access: 'read-only',
    readPath: ['props', 'dataSources'],
    verifyPaths: [['props', 'dataSources']],
  },
  dataBindings: {
    fieldId: 'dataBindings',
    access: 'read-only',
    readPath: ['props', 'dataBindings'],
    verifyPaths: [['props', 'dataBindings']],
  },
  'root.image': {
    fieldId: 'root.image',
    access: 'read-write',
    readPath: ['props', 'backgroundImage'],
    writeTargets: [{ path: ['props', 'backgroundImage'], valuePath: ['base64'] }],
    unsetTargets: [{ path: ['props', 'backgroundImage'] }],
    valueSchema: {
      type: 'object',
      required: ['base64'],
      properties: { base64: { type: 'string' } },
    },
    verifyPaths: [['props', 'backgroundImage']],
  },
  'image.source': {
    fieldId: 'image.source',
    access: 'read-write',
    readPath: ['props', 'src'],
    writeTargets: [
      { path: ['props', 'src'], valuePath: ['base64'] },
      { path: ['extra', '$dashboard', 'rect', 'width'], valuePath: ['raw', 'width'] },
      { path: ['extra', '$dashboard', 'rect', 'height'], valuePath: ['raw', 'height'] },
    ],
    unsetTargets: [{ path: ['props', 'src'] }],
    valueSchema: {
      type: 'object',
      required: ['base64'],
      properties: {
        base64: { type: 'string' },
        raw: {
          type: 'object',
          properties: {
            width: { type: 'number', minimum: 0 },
            height: { type: 'number', minimum: 0 },
          },
        },
      },
    },
    verifyPaths: [
      ['props', 'src'],
      ['extra', '$dashboard', 'rect', 'width'],
      ['extra', '$dashboard', 'rect', 'height'],
    ],
  },
})
