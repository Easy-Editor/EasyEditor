import assert from 'node:assert/strict'
import test from 'node:test'

import { MATERIAL_MANIFEST_BINDING_VERSION, hashMaterialManifestBinding } from '../src/workspace-artifacts.mjs'

const writableManifests = [
  {
    componentName: 'DashboardScene',
    fields: [{ fieldId: 'props.spec', valueSchema: { type: 'object' } }],
  },
  {
    componentName: 'Div',
    fields: [{ fieldId: 'props.background', valueSchema: { type: 'string' } }],
  },
]

test('material manifest identity ignores registry mutation count', () => {
  assert.equal(MATERIAL_MANIFEST_BINDING_VERSION, '1')
  assert.equal(
    hashMaterialManifestBinding({ registryVersion: 23, writableManifests }),
    hashMaterialManifestBinding({ registryVersion: 28, writableManifests }),
  )
})

test('material manifest identity changes when a writable field changes', () => {
  const baseline = hashMaterialManifestBinding({ registryVersion: 23, writableManifests })
  const changed = hashMaterialManifestBinding({
    registryVersion: 23,
    writableManifests: [
      writableManifests[0],
      {
        componentName: 'Div',
        fields: [{ fieldId: 'props.borderColor', valueSchema: { type: 'string' } }],
      },
    ],
  })
  assert.notEqual(baseline, changed)
})

test('material manifest identity rejects missing writable manifests', () => {
  assert.throws(() => hashMaterialManifestBinding({ registryVersion: 23 }), /writableManifests/u)
})
