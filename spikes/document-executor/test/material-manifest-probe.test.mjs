import assert from 'node:assert/strict'
import test from 'node:test'

import { probeMaterialManifestBinding } from '../src/material-manifest-probe.mjs'
import { MATERIAL_MANIFEST_BINDING_VERSION, hashMaterialManifestBinding } from '../src/workspace-artifacts.mjs'

test('probes the exact writable material binding from the built browser host', { timeout: 60_000 }, async () => {
  const binding = await probeMaterialManifestBinding()
  const componentNames = binding.writableManifests.map(manifest => manifest.componentName)
  const dashboardSceneManifest = binding.writableManifests.find(manifest => manifest.componentName === 'DashboardScene')

  assert.equal(String(binding.schemaVersion), MATERIAL_MANIFEST_BINDING_VERSION)
  assert.ok(Number.isSafeInteger(binding.registryVersion))
  assert.ok(componentNames.includes('DateTime'))
  assert.ok(componentNames.includes('DashboardScene'))
  assert.ok(componentNames.includes('Div'))
  assert.ok(dashboardSceneManifest?.fields.some(field => field.fieldId === 'props.widgetData'))
  assert.match(hashMaterialManifestBinding(binding), /^[a-f0-9]{64}$/u)
})
