import assert from 'node:assert/strict'
import test from 'node:test'
import { canonicalJsonStringify, hashCanonicalJson } from '../src/lib/storage/canonical-json.mjs'

test('canonical JSON sorts every object level, preserves array order, and hashes the complete value', async () => {
  const value = {
    z: 1,
    a: [3, { b: null, a: true }],
  }

  assert.equal(canonicalJsonStringify(value), '{"a":[3,{"a":true,"b":null}],"z":1}')
  assert.equal(
    await hashCanonicalJson(value),
    'sha256:630c3d279127032b01130068437e2884b9082d413bbe111fe67d86e2b5b21dbc',
  )
})

test('canonical JSON rejects values that cannot cross a full JSON boundary', () => {
  const cyclic = {}
  cyclic.self = cyclic
  const sparse = []
  sparse.length = 2
  sparse[1] = 1

  for (const value of [undefined, Number.NaN, Number.POSITIVE_INFINITY, 1n, new Date(0), cyclic, sparse]) {
    assert.throws(
      () => canonicalJsonStringify(value),
      error => {
        assert.equal(error.name, 'DashboardStorageError')
        assert.equal(error.code, 'validation-failed')
        return true
      },
    )
  }

  assert.throws(
    () => canonicalJsonStringify({ nested: { invalid: () => null } }),
    error => error.code === 'validation-failed' && error.details.path === '$.nested.invalid',
  )
})
