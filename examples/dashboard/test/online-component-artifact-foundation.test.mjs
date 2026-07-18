import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import {
  createArtifactRevisionKey,
  migrateLegacyNodeArtifactRef,
  readCanonicalNodeArtifactRef,
  validateArtifactRecord,
  validateArtifactRef,
  validateArtifactSourceRevision,
  validateLockedArtifactDependency,
  verifyArtifactRecordIntegrity,
  writeCanonicalNodeArtifactRef,
} from '../src/editor/agent/online-components/artifact-contracts.mjs'
import { scanArtifactSource } from '../src/editor/agent/online-components/artifact-source.mjs'
import { ArtifactStore } from '../src/editor/agent/online-components/artifact-store.mjs'
import { canonicalJsonStringify } from '../src/lib/storage/canonical-json.mjs'
import { MemoryDashboardStorageBackend } from '../src/lib/storage/memory-backend.mjs'
import { ProjectPersistenceCoordinator } from '../src/lib/storage/project-persistence-coordinator.mjs'

const digest = character => `sha256:${character.repeat(64)}`

const sourceRevision = Object.freeze({
  artifactId: 'artifact-kpi',
  sourceRevision: 'revision-7',
  logicalComponentId: 'logical-kpi',
  sourceIntegrity: digest('a'),
})

const onlineRef = Object.freeze({ ...sourceRevision, target: { kind: 'online' } })

const validSource = `
  // import hidden in a comment is inert.
  export default {
    mount(root, ctx) {
      root.textContent = "import('also-inert')";
      ctx.dependencies.chart.import();
    },
    update: (root, ctx) => {
      root.dataset.label = \`value:\${(() => {
        const importText = 'import';
        return ctx.props[importText];
      })()}\`;
    },
    destroy(root) {
      root.replaceChildren();
    },
  };
`

const artifactRecord = (overrides = {}) => ({
  schemaVersion: 1,
  projectId: 'project-1',
  ...sourceRevision,
  source: validSource,
  css: ':host { display: block; }',
  safeManifest: { schemaVersion: 1, displayName: 'KPI', events: ['select'] },
  lockedDependencies: [
    {
      package: 'chart',
      range: '^1.2.0',
      exactVersion: '1.2.3',
      finalUrl: 'https://cdn.example.test/chart@1.2.3/index.mjs',
      integrity: 'sha256-muuNWbTUg8pimOmkUPvzff0rTGOZATWrHQQNdjFAh+w=',
      cached: true,
      module: {
        format: 'bundled-esm',
        contentType: 'text/javascript',
        encoding: 'base64',
        byteLength: 17,
        bytes: 'ZXhwb3J0IGRlZmF1bHQge30=',
      },
    },
  ],
  dependencyLockDigest: digest('c'),
  diagnostics: [],
  provenance: { actor: 'agent', taskId: 'task-1' },
  createdAt: 100,
  supersedes: null,
  ...overrides,
})

const hashBytes = async bytes => new Uint8Array(createHash('sha256').update(bytes).digest())
const sha256Digest = value => `sha256:${createHash('sha256').update(value).digest('hex')}`
const sha256Sri = value => `sha256-${createHash('sha256').update(value).digest('base64')}`

const integrityArtifactRecord = () => {
  const dependencyBytes = Buffer.from('export default {}')
  const lockedDependencies = [
    {
      ...artifactRecord().lockedDependencies[0],
      integrity: sha256Sri(dependencyBytes),
      module: {
        ...artifactRecord().lockedDependencies[0].module,
        byteLength: dependencyBytes.byteLength,
        bytes: dependencyBytes.toString('base64'),
      },
    },
  ]
  return artifactRecord({
    sourceIntegrity: sha256Digest(validSource),
    lockedDependencies,
    dependencyLockDigest: sha256Digest(canonicalJsonStringify(lockedDependencies)),
  })
}

const assertDeeplyFrozen = value => {
  assert.equal(Object.isFrozen(value), true)
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) assertDeeplyFrozen(child)
  }
}

test('ArtifactSourceRevision, ArtifactRef, and ArtifactRecord are strict detached deeply frozen JSON DTOs', () => {
  const mutable = artifactRecord()
  const revision = validateArtifactSourceRevision(sourceRevision)
  const ref = validateArtifactRef(onlineRef)
  const record = validateArtifactRecord(mutable)

  mutable.safeManifest.events.push('mutated-after-validation')
  mutable.lockedDependencies[0].exactVersion = '9.9.9'

  assert.deepEqual(revision, sourceRevision)
  assert.deepEqual(ref, onlineRef)
  assert.equal(record.safeManifest.events.includes('mutated-after-validation'), false)
  assert.equal(record.lockedDependencies[0].exactVersion, '1.2.3')
  assertDeeplyFrozen(revision)
  assertDeeplyFrozen(ref)
  assertDeeplyFrozen(record)
  assert.equal(createArtifactRevisionKey(sourceRevision), `artifact-kpi@revision-7@${encodeURIComponent(digest('a'))}`)

  assert.throws(
    () => validateArtifactSourceRevision({ ...sourceRevision, unexpected: true }),
    error =>
      error.code === 'validation-failed' && error.reason === 'artifact-source-revision-fields-must-match-contract',
  )
  assert.throws(
    () => validateArtifactRef({ ...onlineRef, target: { kind: 'remote-script' } }),
    error => error.code === 'validation-failed' && error.reason === 'artifact-ref-target-kind-is-unsupported',
  )
  assert.throws(
    () => validateArtifactRecord(artifactRecord({ schemaVersion: 2 })),
    error => error.code === 'validation-failed' && error.reason === 'artifact-record-schema-version-is-unsupported',
  )
  assert.throws(
    () => validateArtifactRecord(artifactRecord({ safeManifest: { schemaVersion: 2 } })),
    error =>
      error.code === 'validation-failed' &&
      error.reason === 'artifact-record.safeManifest-schema-version-is-unsupported',
  )
  assert.throws(
    () => validateArtifactRecord({ ...artifactRecord(), extra: 'not-allowed' }),
    error => error.code === 'validation-failed' && error.reason === 'artifact-record-fields-must-match-contract',
  )
  assert.throws(
    () => validateArtifactRecord(artifactRecord({ provenance: { value: undefined } })),
    error => error.code === 'validation-failed' && error.reason === 'value-is-not-json',
  )
})

test('ArtifactRecord integrity verification binds source, dependency bytes, SRI, and canonical lock digest', async t => {
  const valid = integrityArtifactRecord()
  const verified = await verifyArtifactRecordIntegrity(valid, { hashBytes })

  assert.deepEqual(verified, valid)
  assertDeeplyFrozen(verified)

  await t.test('source tamper fails', async () => {
    await assert.rejects(
      verifyArtifactRecordIntegrity({ ...valid, source: `${valid.source}\n// tampered` }, { hashBytes }),
      error => error.code === 'integrity-mismatch' && /source digest/iu.test(error.reason),
    )
  })

  await t.test('dependency bytes tamper fails', async () => {
    const bytes = Buffer.from('export default { tampered: true }')
    await assert.rejects(
      verifyArtifactRecordIntegrity(
        {
          ...valid,
          lockedDependencies: [
            {
              ...valid.lockedDependencies[0],
              module: {
                ...valid.lockedDependencies[0].module,
                byteLength: bytes.byteLength,
                bytes: bytes.toString('base64'),
              },
            },
          ],
        },
        { hashBytes },
      ),
      error => error.code === 'integrity-mismatch' && /dependency integrity/iu.test(error.reason),
    )
  })

  await t.test('dependency SRI tamper fails', async () => {
    await assert.rejects(
      verifyArtifactRecordIntegrity(
        {
          ...valid,
          lockedDependencies: [
            {
              ...valid.lockedDependencies[0],
              integrity: `sha256-${'A'.repeat(43)}=`,
            },
          ],
        },
        { hashBytes },
      ),
      error => error.code === 'integrity-mismatch' && /dependency integrity/iu.test(error.reason),
    )
  })

  await t.test('dependency lock digest mismatch fails', async () => {
    await assert.rejects(
      verifyArtifactRecordIntegrity({ ...valid, dependencyLockDigest: digest('f') }, { hashBytes }),
      error => error.code === 'integrity-mismatch' && /lock digest/iu.test(error.reason),
    )
  })
})

test('locked dependencies accept only the canonical resolver DTO without invoking accessors', () => {
  const dependency = artifactRecord().lockedDependencies[0]
  const locked = validateLockedArtifactDependency(dependency)

  assert.deepEqual(locked, dependency)
  assertDeeplyFrozen(locked)
  assert.throws(
    () => validateLockedArtifactDependency({ ...dependency, extra: true }),
    error =>
      error.code === 'validation-failed' && error.reason === 'artifact-locked-dependency-fields-must-match-contract',
  )
  assert.throws(
    () => validateLockedArtifactDependency({ ...dependency, integrity: digest('a') }),
    error =>
      error.code === 'validation-failed' && error.reason === 'artifact-locked-dependency.integrity-must-be-sha256-sri',
  )
  assert.throws(
    () =>
      validateLockedArtifactDependency({
        ...dependency,
        module: { ...dependency.module, format: 'esm' },
      }),
    error =>
      error.code === 'validation-failed' && error.reason === 'artifact-locked-dependency.module-contract-is-invalid',
  )
  assert.throws(
    () =>
      validateLockedArtifactDependency({
        ...dependency,
        module: { ...dependency.module, byteLength: dependency.module.byteLength + 1 },
      }),
    error =>
      error.code === 'validation-failed' &&
      error.reason === 'artifact-locked-dependency.module.byteLength-does-not-match-bytes',
  )
  assert.throws(
    () =>
      validateLockedArtifactDependency({
        ...dependency,
        module: { ...dependency.module, bytes: 'AB==' },
      }),
    error =>
      error.code === 'validation-failed' &&
      error.reason === 'artifact-locked-dependency.module.bytes-is-not-canonical-base64',
  )
  assert.throws(
    () => validateLockedArtifactDependency({ ...dependency, finalUrl: 'http://cdn.example.test/chart.mjs' }),
    error =>
      error.code === 'validation-failed' && error.reason === 'artifact-locked-dependency.finalUrl-must-be-an-https-url',
  )

  let getterRuns = 0
  const hostile = { ...dependency }
  Object.defineProperty(hostile, 'package', {
    enumerable: true,
    get() {
      getterRuns += 1
      return 'chart'
    },
  })
  assert.throws(
    () => validateLockedArtifactDependency(hostile),
    error => error.code === 'validation-failed' && error.reason === 'accessor-values-are-not-json',
  )
  assert.equal(getterRuns, 0)
})

test('locked dependency exact versions use strict SemVer prerelease identifiers', () => {
  const dependency = artifactRecord().lockedDependencies[0]

  for (const exactVersion of ['01.2.0', '1.02.0', '1.2.00', '1.2.0-01', '1.2.0-alpha.01']) {
    assert.throws(
      () => validateLockedArtifactDependency({ ...dependency, exactVersion }),
      error =>
        error.code === 'validation-failed' && error.reason === 'artifact-locked-dependency.exactVersion-is-invalid',
      exactVersion,
    )
  }

  assert.throws(
    () =>
      validateArtifactRecord(
        artifactRecord({
          lockedDependencies: [{ ...dependency, exactVersion: '1.2.0-01' }],
        }),
      ),
    error =>
      error.code === 'validation-failed' && error.reason === 'artifact-locked-dependency.exactVersion-is-invalid',
  )

  for (const exactVersion of ['1.2.0-0', '1.2.0-alpha', '1.2.0-alpha.01a', '1.2.0-0A+build.001']) {
    assert.equal(validateLockedArtifactDependency({ ...dependency, exactVersion }).exactVersion, exactVersion)
  }
})

test('artifact records reject duplicate dependency packages', () => {
  const dependency = artifactRecord().lockedDependencies[0]
  assert.throws(
    () =>
      validateArtifactRecord(
        artifactRecord({
          lockedDependencies: [dependency, { ...dependency, exactVersion: '1.2.4' }],
        }),
      ),
    error =>
      error.code === 'validation-failed' &&
      error.reason === 'artifact-record.lockedDependencies-must-not-contain-duplicate-packages',
  )
})

test('local-material ArtifactRef keeps immutable online rollback identity and rejects malformed targets', () => {
  const promoted = validateArtifactRef({
    ...sourceRevision,
    target: {
      kind: 'local-material',
      materialId: 'material-kpi',
      materialVersion: '1.0.0',
      buildIntegrity: digest('d'),
    },
    rollbackTo: sourceRevision,
  })
  assert.equal(promoted.target.kind, 'local-material')
  assert.deepEqual(promoted.rollbackTo, sourceRevision)
  assertDeeplyFrozen(promoted)
  assert.throws(
    () => validateArtifactRef({ ...promoted, rollbackTo: { ...sourceRevision, extra: true } }),
    error => error.code === 'validation-failed',
  )
})

test('canonical artifact metadata is top-level $agent and ordinary writes remove both legacy locations', () => {
  const ordinary = writeCanonicalNodeArtifactRef(
    {
      componentName: 'GeneratedMaterialHost',
      artifactRef: onlineRef,
      extra: {
        title: 'KPI',
        artifactRef: onlineRef,
      },
    },
    onlineRef,
  )
  assert.deepEqual(ordinary, {
    $agent: { schemaVersion: 1, artifactRef: onlineRef },
    componentName: 'GeneratedMaterialHost',
    extra: { title: 'KPI' },
  })
  assert.equal(Object.hasOwn(ordinary, 'artifactRef'), false)
  assert.equal(Object.hasOwn(ordinary.extra, 'artifactRef'), false)
  assert.deepEqual(readCanonicalNodeArtifactRef(ordinary), onlineRef)
  assertDeeplyFrozen(ordinary)
})

test('legacy top-level and literal node.extra refs migrate explicitly with strict conflict handling', () => {
  const legacy = {
    componentName: 'GeneratedMaterialHost',
    extra: { title: 'Legacy KPI', artifactRef: onlineRef },
  }
  assert.deepEqual(readCanonicalNodeArtifactRef(legacy), onlineRef)
  const migrated = migrateLegacyNodeArtifactRef(legacy)
  assert.deepEqual(migrated, {
    $agent: { schemaVersion: 1, artifactRef: onlineRef },
    componentName: 'GeneratedMaterialHost',
    extra: { title: 'Legacy KPI' },
  })
  assert.equal(Object.hasOwn(migrated.extra, 'artifactRef'), false)
  assert.deepEqual(legacy, {
    componentName: 'GeneratedMaterialHost',
    extra: { title: 'Legacy KPI', artifactRef: onlineRef },
  })
  assert.throws(
    () =>
      migrateLegacyNodeArtifactRef({
        $agent: { schemaVersion: 1, artifactRef: onlineRef },
        extra: {
          artifactRef: { ...onlineRef, sourceRevision: 'different' },
        },
      }),
    error => error.code === 'integrity-mismatch' && error.reason === 'legacy-and-canonical-artifact-refs-conflict',
  )
  assert.throws(
    () =>
      readCanonicalNodeArtifactRef({
        $agent: { schemaVersion: 2, artifactRef: onlineRef },
        artifactRef: onlineRef,
      }),
    error => error.code === 'validation-failed' && error.reason === 'node-extra.$agent-schema-version-is-unsupported',
  )
  assert.deepEqual(
    readCanonicalNodeArtifactRef({ artifactRef: onlineRef, extra: { artifactRef: onlineRef } }),
    onlineRef,
  )
  assert.throws(
    () =>
      readCanonicalNodeArtifactRef({
        artifactRef: onlineRef,
        extra: { artifactRef: { ...onlineRef, sourceRevision: 'different' } },
      }),
    error => error.code === 'integrity-mismatch' && error.reason === 'legacy-artifact-refs-conflict',
  )
})

test('artifact records enforce source, CSS, dependency-count, and total-record budgets before persistence', () => {
  assert.throws(
    () => validateArtifactRecord(artifactRecord({ source: `export default { /*${'x'.repeat(256 * 1024)}*/ }` })),
    error => error.code === 'validation-failed' && error.reason === 'artifact-record.source-exceeds-byte-budget',
  )
  assert.throws(
    () => validateArtifactRecord(artifactRecord({ css: 'x'.repeat(128 * 1024 + 1) })),
    error => error.code === 'validation-failed' && error.reason === 'artifact-record.css-exceeds-byte-budget',
  )
  assert.throws(
    () => validateArtifactRecord(artifactRecord({ lockedDependencies: Array.from({ length: 65 }, () => null) })),
    error =>
      error.code === 'validation-failed' && error.reason === 'artifact-record.lockedDependencies-exceeds-count-budget',
  )
  assert.throws(
    () =>
      validateArtifactRecord(
        artifactRecord({
          lockedDependencies: [
            {
              ...artifactRecord().lockedDependencies[0],
              module: {
                ...artifactRecord().lockedDependencies[0].module,
                byteLength: 1_572_864,
                bytes: 'AAAA'.repeat(524_288),
              },
            },
          ],
        }),
      ),
    error => error.code === 'validation-failed' && error.reason === 'artifact-record-exceeds-byte-budget',
  )
})

test('artifact source scanner accepts a default lifecycle object without treating inert import text as code', () => {
  const first = scanArtifactSource(validSource)
  const second = scanArtifactSource(validSource)
  assert.deepEqual(first, {
    schemaVersion: 1,
    moduleFormat: 'esm-default-object',
    lifecycleMethods: ['destroy', 'mount', 'update'],
    sourceBytes: new TextEncoder().encode(validSource).byteLength,
  })
  assert.deepEqual(second, first)
  assertDeeplyFrozen(first)
})

test('artifact source scanner rejects static, dynamic, escaped, and nested-template imports', () => {
  const invalidSources = [
    `import chart from 'chart'; export default { mount() {}, destroy() {} }`,
    `const chart = import('chart'); export default { mount() {}, destroy() {} }`,
    String.raw`const chart = im\u0070ort('chart'); export default { mount() {}, destroy() {} }`,
    "export default { mount(root) { root.textContent = `${import('chart')}` }, destroy() {} }",
    `export { chart } from 'chart'; export default { mount() {}, update() {}, destroy() {} }`,
    `export * from 'chart'; export default { mount() {}, update() {}, destroy() {} }`,
  ]
  for (const source of invalidSources) {
    assert.throws(
      () => scanArtifactSource(source),
      error => error.code === 'validation-failed' && error.reason === 'artifact-source-imports-are-forbidden',
    )
  }
})

test('artifact source scanner requires the complete synchronous lifecycle contract', () => {
  const cases = [
    ['export default { async mount() {}, update() {}, destroy() {} }', 'artifact-source-mount-must-be-synchronous'],
    [
      'export default { mount() {}, update: async () => {}, destroy() {} }',
      'artifact-source-update-must-be-synchronous',
    ],
    [
      'export default { mount() {}, update() {}, destroy: async function () {} }',
      'artifact-source-destroy-must-be-synchronous',
    ],
    ['export default { mount() {}, destroy() {} }', 'artifact-source-update-is-required'],
  ]
  for (const [source, reason] of cases) {
    assert.throws(
      () => scanArtifactSource(source),
      error => error.code === 'validation-failed' && error.reason === reason,
    )
  }
})

test('artifact source scanner fails closed on unterminated lexemes and unusable default exports', () => {
  const cases = [
    ['/* never closes', 'artifact-source-unterminated-block-comment'],
    [`export default { mount() { return 'never closes }, destroy() {} }`, 'artifact-source-unterminated-string'],
    ['export default { mount() { return `never closes }, destroy() {} }', 'artifact-source-unterminated-template'],
    ['export default createLifecycle()', 'artifact-source-default-export-must-be-an-object-literal'],
    ['export default { mount: null, destroy() {} }', 'artifact-source-mount-must-be-a-function'],
    ['export default { mount() {}, update() {} }', 'artifact-source-destroy-is-required'],
    [
      'export default { ...lifecycle, mount() {}, destroy() {} }',
      'artifact-source-default-export-spreads-are-unsupported',
    ],
  ]
  for (const [source, reason] of cases) {
    assert.throws(
      () => scanArtifactSource(source),
      error => error.code === 'validation-failed' && error.reason === reason,
    )
  }
})

test('ArtifactStore accepts only ProjectPersistenceCoordinator and reconciles immutable artifacts and roots', async () => {
  const backend = new MemoryDashboardStorageBackend()
  const coordinator = new ProjectPersistenceCoordinator({ backend })
  const store = new ArtifactStore({ coordinator })
  const record = artifactRecord()

  assert.throws(
    () => new ArtifactStore({ coordinator: backend }),
    error => error.code === 'validation-failed' && error.reason === 'artifact-store-coordinator-is-required',
  )

  const created = await store.createArtifact(record)
  const retried = await store.createArtifact(record)
  assert.equal(created.status, 'created')
  assert.equal(retried.status, 'reconciled')
  assert.deepEqual(retried.artifact, created.artifact)
  assertDeeplyFrozen(created)
  assertDeeplyFrozen(retried)

  await assert.rejects(
    store.createArtifact(artifactRecord({ css: ':host { display: none; }' })),
    error =>
      error.code === 'integrity-mismatch' && error.reason === 'artifact-revision-was-reused-with-different-bytes',
  )
  const read = await store.readArtifact({
    schemaVersion: 1,
    projectId: 'project-1',
    artifactId: 'artifact-kpi',
    sourceRevision: 'revision-7',
  })
  assert.deepEqual(read, created.artifact)
  assertDeeplyFrozen(read)

  const root = {
    schemaVersion: 1,
    projectId: 'project-1',
    branchId: 'main',
    ownerType: 'checkpoint',
    ownerId: 'checkpoint-1',
    artifactId: 'artifact-kpi',
    sourceRevision: 'revision-7',
  }
  assert.equal((await store.createArtifactRoot(root)).status, 'created')
  assert.equal((await store.createArtifactRoot(root)).status, 'reconciled')
  assert.deepEqual(await store.readArtifactRoot(root), root)
  assert.equal((await store.deleteArtifactRoot(root)).status, 'deleted')
  assert.equal((await store.deleteArtifactRoot(root)).status, 'absent')
  assert.equal(await store.readArtifactRoot(root), null)
})
