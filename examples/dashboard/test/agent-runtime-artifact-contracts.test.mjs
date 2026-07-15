import assert from 'node:assert/strict'
import test from 'node:test'
import {
  GENERATED_MATERIAL_HOST_COMPONENT_NAME,
  dashboardConfigureAnnotations,
  promoteGeneratedNodeArtifact,
} from '../src/editor/agent/phase-0-contracts.mjs'

test('promotion switches only the ArtifactRef target and preserves trusted proxy identity', () => {
  const onlineArtifactRef = {
    artifactId: 'artifact-kpi',
    sourceRevision: 'revision-7',
    logicalComponentId: 'logical-kpi',
    sourceIntegrity: 'sha256-source',
    target: { kind: 'online' },
  }
  const binding = {
    componentName: GENERATED_MATERIAL_HOST_COMPONENT_NAME,
    artifactRef: onlineArtifactRef,
  }

  const promoted = promoteGeneratedNodeArtifact(binding, {
    kind: 'local-material',
    materialId: 'material-kpi',
    materialVersion: '1.0.0',
    buildIntegrity: 'sha256-build',
  })

  assert.equal(promoted.componentName, 'GeneratedMaterialHost')
  assert.notStrictEqual(promoted.artifactRef, onlineArtifactRef)
  assert.deepEqual(promoted.artifactRef, {
    artifactId: 'artifact-kpi',
    sourceRevision: 'revision-7',
    logicalComponentId: 'logical-kpi',
    sourceIntegrity: 'sha256-source',
    target: {
      kind: 'local-material',
      materialId: 'material-kpi',
      materialVersion: '1.0.0',
      buildIntegrity: 'sha256-build',
    },
    rollbackTo: {
      artifactId: 'artifact-kpi',
      sourceRevision: 'revision-7',
      logicalComponentId: 'logical-kpi',
      sourceIntegrity: 'sha256-source',
    },
  })
  assert.deepEqual(onlineArtifactRef.target, { kind: 'online' })
})

test('configure annotations are a JSON-only sidecar for callback-backed fields', () => {
  const serialized = JSON.stringify(dashboardConfigureAnnotations)

  assert.deepEqual(JSON.parse(serialized), dashboardConfigureAnnotations)
  for (const [fieldId, annotation] of Object.entries(dashboardConfigureAnnotations)) {
    assert.equal(annotation.fieldId, fieldId)
  }

  assert.deepEqual(dashboardConfigureAnnotations['shared.id'], {
    fieldId: 'shared.id',
    access: 'read-only',
    readPath: ['node', 'id'],
    verifyPaths: [['node', 'id']],
  })
  assert.deepEqual(dashboardConfigureAnnotations['shared.rect'].writeTargets, [
    { path: ['extra', '$dashboard', 'rect'] },
  ])
  assert.deepEqual(dashboardConfigureAnnotations['shared.visibility'].writeTargets, [{ path: ['extra', 'condition'] }])
  assert.deepEqual(dashboardConfigureAnnotations['root.image'].writeTargets, [
    { path: ['props', 'backgroundImage'], valuePath: ['base64'] },
  ])
  assert.deepEqual(dashboardConfigureAnnotations['image.source'].writeTargets, [
    { path: ['props', 'src'], valuePath: ['base64'] },
    { path: ['extra', '$dashboard', 'rect', 'width'], valuePath: ['raw', 'width'] },
    { path: ['extra', '$dashboard', 'rect', 'height'], valuePath: ['raw', 'height'] },
  ])
  assert.deepEqual(dashboardConfigureAnnotations['image.source'].unsetTargets, [{ path: ['props', 'src'] }])
})
