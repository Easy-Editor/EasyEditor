import { canonicalJsonStringify } from './canonical-json.mjs'
import { DASHBOARD_STORAGE_ERROR_CODE, DashboardStorageError } from './errors.mjs'

export const DASHBOARD_MATERIAL_GC_STORE_NAMES = Object.freeze([
  'workingDrafts',
  'projectVersions',
  'agentSessions',
  'taskJournals',
  'toolReceipts',
  'receiptIntents',
  'agentCheckpoints',
  'artifactRefs',
])

const failure = reason => new DashboardStorageError(DASHBOARD_STORAGE_ERROR_CODE.validationFailed, reason)

const requireProjectId = value => {
  if (typeof value !== 'string' || value.length === 0) {
    throw failure('material-gc-snapshot.projectId-must-be-a-non-empty-string')
  }
  return value
}

const assertRecord = (value, label) => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw failure(`${label}-must-be-an-object`)
  }
}

const assertExactFields = (value, fields, label) => {
  assertRecord(value, label)
  const actual = Object.keys(value).sort()
  const expected = [...fields].sort()
  if (actual.length !== expected.length || actual.some((field, index) => field !== expected[index])) {
    throw failure(`${label}-fields-must-match-contract`)
  }
}

export const createMaterialGcStoreSnapshot = (projectIdValue, recordsByStore) => {
  const projectId = requireProjectId(projectIdValue)
  const stores = Object.fromEntries(
    DASHBOARD_MATERIAL_GC_STORE_NAMES.map(store => {
      const records = recordsByStore[store]
      if (!Array.isArray(records)) throw failure(`material-gc-snapshot.stores.${store}-must-be-an-array`)
      return [store, records.filter(record => record?.projectId === projectId).map(record => structuredClone(record))]
    }),
  )
  return Object.freeze({ schemaVersion: 1, projectId, stores: Object.freeze(stores) })
}

export const validateMaterialGcStoreSnapshot = (value, expectedProjectId) => {
  canonicalJsonStringify(value)
  assertExactFields(value, ['projectId', 'schemaVersion', 'stores'], 'material-gc-snapshot')
  if (value.schemaVersion !== 1) throw failure('material-gc-snapshot-schema-version-is-unsupported')
  const projectId = requireProjectId(value.projectId)
  if (projectId !== expectedProjectId) throw failure('material-gc-snapshot-project-authority-mismatch')
  assertExactFields(value.stores, DASHBOARD_MATERIAL_GC_STORE_NAMES, 'material-gc-snapshot.stores')
  const stores = Object.fromEntries(
    DASHBOARD_MATERIAL_GC_STORE_NAMES.map(store => {
      const records = value.stores[store]
      if (!Array.isArray(records)) throw failure(`material-gc-snapshot.stores.${store}-must-be-an-array`)
      for (const record of records) {
        assertRecord(record, `material-gc-snapshot.stores.${store}.record`)
        if (record.projectId !== projectId) {
          throw failure(`material-gc-snapshot.stores.${store}-contains-cross-project-record`)
        }
      }
      return [store, records.map(record => structuredClone(record))]
    }),
  )
  return Object.freeze({ schemaVersion: 1, projectId, stores: Object.freeze(stores) })
}
