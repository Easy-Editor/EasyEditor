import {
  PersistenceLineageContractError,
  assertExactRecord,
  cloneJsonObject,
  cloneJsonValue,
  compareCodeUnits,
  failContract,
  freezeDto,
  jsonDataEqual,
  optionalOwnDataValue,
  ownDataValue,
  requireLiteral,
  requireNonEmptyString,
  requireNonNegativeInteger,
  requireSchemaVersion,
  requireSha256,
} from './contract.mjs'
import { parseMutationProvenance, parseProvenanceToken } from './provenance.mjs'

export { PersistenceLineageContractError }

const TOOL_RECEIPT_STATUSES = Object.freeze(['applied', 'not-applied', 'indeterminate', 'rejected'])
const FAILED_RECEIPT_STATUSES = Object.freeze(['not-applied', 'rejected'])

const parseAuthority = (value, label) => ({
  projectId: requireNonEmptyString(ownDataValue(value, 'projectId', label), `${label}.projectId`),
  branchId: requireNonEmptyString(ownDataValue(value, 'branchId', label), `${label}.branchId`),
  callId: requireNonEmptyString(ownDataValue(value, 'callId', label), `${label}.callId`),
})

const authorityMatches = (value, expected) =>
  value.projectId === expected.projectId && value.branchId === expected.branchId && value.callId === expected.callId

const parseAffectedSlotToken = (value, label, authority) => {
  assertExactRecord(value, ['slotKey', 'token'], [], label)
  const slotKey = requireNonEmptyString(ownDataValue(value, 'slotKey', label), `${label}.slotKey`)
  const token = ownDataValue(value, 'token', label)
  const parsedToken = parseProvenanceToken(token)
  if (parsedToken.source !== 'agent' || parsedToken.callId !== authority.callId) {
    return failContract('must-be-owned-by-the-witness-call', `${label}.token`)
  }
  parseMutationProvenance({
    schemaVersion: 1,
    projectId: authority.projectId,
    branchId: authority.branchId,
    slotKey,
    draftGeneration: 0,
    token,
  })
  return { slotKey, token }
}

const parseAffectedSlotTokens = (value, authority, label) => {
  if (!Array.isArray(value) || value.length === 0) return failContract('must-be-a-non-empty-array', label)
  const cloned = cloneJsonValue(value, label)
  const parsed = cloned.map((entry, index) => parseAffectedSlotToken(entry, `${label}[${index}]`, authority))
  parsed.sort((left, right) => compareCodeUnits(left.slotKey, right.slotKey))
  if (parsed.some((entry, index) => index > 0 && entry.slotKey === parsed[index - 1].slotKey)) {
    return failContract('slot-keys-must-be-unique', label)
  }
  return parsed
}

export const parseReceiptIntent = value => {
  assertExactRecord(
    value,
    [
      'schemaVersion',
      'projectId',
      'branchId',
      'callId',
      'preparedHash',
      'baseRevision',
      'preImages',
      'expectedPostImages',
      'status',
    ],
    [],
    'ReceiptIntent',
  )
  const schemaVersion = requireSchemaVersion(
    ownDataValue(value, 'schemaVersion', 'ReceiptIntent'),
    'ReceiptIntent.schemaVersion',
  )
  const authority = parseAuthority(value, 'ReceiptIntent')
  const preparedHash = requireSha256(ownDataValue(value, 'preparedHash', 'ReceiptIntent'), 'ReceiptIntent.preparedHash')
  const baseRevision = requireNonEmptyString(
    ownDataValue(value, 'baseRevision', 'ReceiptIntent'),
    'ReceiptIntent.baseRevision',
  )
  const preImages = cloneJsonValue(ownDataValue(value, 'preImages', 'ReceiptIntent'), 'ReceiptIntent.preImages')
  const expectedPostImages = cloneJsonValue(
    ownDataValue(value, 'expectedPostImages', 'ReceiptIntent'),
    'ReceiptIntent.expectedPostImages',
  )
  const status = requireLiteral(ownDataValue(value, 'status', 'ReceiptIntent'), ['pending'], 'ReceiptIntent.status')
  return freezeDto({
    schemaVersion,
    ...authority,
    preparedHash,
    baseRevision,
    preImages,
    expectedPostImages,
    status,
  })
}

export const createReceiptIntent = parseReceiptIntent

export const parseToolReceipt = value => {
  assertExactRecord(
    value,
    ['schemaVersion', 'projectId', 'branchId', 'callId', 'status'],
    ['revision', 'witness', 'failure'],
    'ToolReceipt',
  )
  const schemaVersion = requireSchemaVersion(
    ownDataValue(value, 'schemaVersion', 'ToolReceipt'),
    'ToolReceipt.schemaVersion',
  )
  const authority = parseAuthority(value, 'ToolReceipt')
  const status = requireLiteral(
    ownDataValue(value, 'status', 'ToolReceipt'),
    TOOL_RECEIPT_STATUSES,
    'ToolReceipt.status',
  )
  const revisionValue = optionalOwnDataValue(value, 'revision', 'ToolReceipt')
  const witnessValue = optionalOwnDataValue(value, 'witness', 'ToolReceipt')
  const failureValue = optionalOwnDataValue(value, 'failure', 'ToolReceipt')
  const revision =
    revisionValue === undefined ? undefined : requireNonEmptyString(revisionValue, 'ToolReceipt.revision')
  const witness = witnessValue === undefined ? undefined : cloneJsonObject(witnessValue, 'ToolReceipt.witness')
  let failure
  if (failureValue !== undefined) {
    assertExactRecord(failureValue, ['code', 'message', 'retryable'], ['details'], 'ToolReceipt.failure')
    const detailsValue = optionalOwnDataValue(failureValue, 'details', 'ToolReceipt.failure')
    failure = freezeDto({
      code: requireNonEmptyString(
        ownDataValue(failureValue, 'code', 'ToolReceipt.failure'),
        'ToolReceipt.failure.code',
      ),
      message: requireNonEmptyString(
        ownDataValue(failureValue, 'message', 'ToolReceipt.failure'),
        'ToolReceipt.failure.message',
      ),
      retryable: requireLiteral(
        ownDataValue(failureValue, 'retryable', 'ToolReceipt.failure'),
        [true, false],
        'ToolReceipt.failure.retryable',
      ),
      ...(detailsValue === undefined ? {} : { details: cloneJsonObject(detailsValue, 'ToolReceipt.failure.details') }),
    })
  }
  if (status === 'applied' && failure !== undefined) {
    return failContract('must-be-absent-for-applied-receipt', 'ToolReceipt.failure')
  }
  if (status !== 'applied' && failure === undefined) {
    return failContract('is-required-for-non-applied-receipt', 'ToolReceipt.failure')
  }
  return freezeDto({
    schemaVersion,
    ...authority,
    status,
    ...(revision === undefined ? {} : { revision }),
    ...(witness === undefined ? {} : { witness }),
    ...(failure === undefined ? {} : { failure }),
  })
}

export const createToolReceipt = parseToolReceipt

export const parseApplyWitness = value => {
  assertExactRecord(
    value,
    [
      'schemaVersion',
      'projectId',
      'branchId',
      'callId',
      'draftGeneration',
      'coreMutationVersion',
      'transactionFingerprint',
      'affectedSlotTokens',
    ],
    [],
    'ApplyWitness',
  )
  const schemaVersion = requireSchemaVersion(
    ownDataValue(value, 'schemaVersion', 'ApplyWitness'),
    'ApplyWitness.schemaVersion',
  )
  const authority = parseAuthority(value, 'ApplyWitness')
  const draftGeneration = requireNonNegativeInteger(
    ownDataValue(value, 'draftGeneration', 'ApplyWitness'),
    'ApplyWitness.draftGeneration',
  )
  const coreMutationVersion = requireNonNegativeInteger(
    ownDataValue(value, 'coreMutationVersion', 'ApplyWitness'),
    'ApplyWitness.coreMutationVersion',
  )
  const transactionFingerprint = requireSha256(
    ownDataValue(value, 'transactionFingerprint', 'ApplyWitness'),
    'ApplyWitness.transactionFingerprint',
  )
  const affectedSlotTokens = parseAffectedSlotTokens(
    ownDataValue(value, 'affectedSlotTokens', 'ApplyWitness'),
    authority,
    'ApplyWitness.affectedSlotTokens',
  )
  return freezeDto({
    schemaVersion,
    ...authority,
    draftGeneration,
    coreMutationVersion,
    transactionFingerprint,
    affectedSlotTokens,
  })
}

export const createApplyWitness = parseApplyWitness

export const parseFailureWitness = value => {
  assertExactRecord(
    value,
    [
      'schemaVersion',
      'projectId',
      'branchId',
      'callId',
      'draftGeneration',
      'transactionFingerprint',
      'receiptStatus',
      'failureCode',
    ],
    [],
    'FailureWitness',
  )
  const schemaVersion = requireSchemaVersion(
    ownDataValue(value, 'schemaVersion', 'FailureWitness'),
    'FailureWitness.schemaVersion',
  )
  const authority = parseAuthority(value, 'FailureWitness')
  const draftGeneration = requireNonNegativeInteger(
    ownDataValue(value, 'draftGeneration', 'FailureWitness'),
    'FailureWitness.draftGeneration',
  )
  const transactionFingerprint = requireSha256(
    ownDataValue(value, 'transactionFingerprint', 'FailureWitness'),
    'FailureWitness.transactionFingerprint',
  )
  const receiptStatus = requireLiteral(
    ownDataValue(value, 'receiptStatus', 'FailureWitness'),
    FAILED_RECEIPT_STATUSES,
    'FailureWitness.receiptStatus',
  )
  const failureCode = requireNonEmptyString(
    ownDataValue(value, 'failureCode', 'FailureWitness'),
    'FailureWitness.failureCode',
  )
  return freezeDto({
    schemaVersion,
    ...authority,
    draftGeneration,
    transactionFingerprint,
    receiptStatus,
    failureCode,
  })
}

export const createFailureWitness = parseFailureWitness

const applyWitnessReference = witness => ({
  schemaVersion: 1,
  kind: 'apply',
  draftGeneration: witness.draftGeneration,
  coreMutationVersion: witness.coreMutationVersion,
  transactionFingerprint: witness.transactionFingerprint,
  affectedSlotTokens: witness.affectedSlotTokens.map(entry => ({ ...entry })),
})

const failureWitnessReference = witness => ({
  schemaVersion: 1,
  kind: 'failure',
  draftGeneration: witness.draftGeneration,
  transactionFingerprint: witness.transactionFingerprint,
  receiptStatus: witness.receiptStatus,
  failureCode: witness.failureCode,
})

export const createToolReceiptWitness = witness => {
  const descriptors =
    typeof witness === 'object' && witness !== null && !Array.isArray(witness)
      ? Object.getOwnPropertyDescriptors(witness)
      : null
  if (descriptors?.coreMutationVersion && 'value' in descriptors.coreMutationVersion) {
    return freezeDto(applyWitnessReference(parseApplyWitness(witness)))
  }
  if (descriptors?.failureCode && 'value' in descriptors.failureCode) {
    return freezeDto(failureWitnessReference(parseFailureWitness(witness)))
  }
  return failContract('must-be-an-apply-or-failure-witness', 'ToolReceipt.witness')
}

const indeterminate = reason => freezeDto({ classification: 'indeterminate', reason })

const parseOptionalEvidence = (value, parser) => (value === null || value === undefined ? null : parser(value))

export const classifyReceiptRecovery = value => {
  try {
    assertExactRecord(
      value,
      ['projectId', 'branchId', 'callId'],
      ['receiptIntent', 'receipt', 'applyWitness', 'failureWitness'],
      'ReceiptRecoveryEvidence',
    )
    const expectedAuthority = parseAuthority(value, 'ReceiptRecoveryEvidence')
    const receiptIntent = parseOptionalEvidence(
      optionalOwnDataValue(value, 'receiptIntent', 'ReceiptRecoveryEvidence'),
      parseReceiptIntent,
    )
    const receipt = parseOptionalEvidence(
      optionalOwnDataValue(value, 'receipt', 'ReceiptRecoveryEvidence'),
      parseToolReceipt,
    )
    const applyWitness = parseOptionalEvidence(
      optionalOwnDataValue(value, 'applyWitness', 'ReceiptRecoveryEvidence'),
      parseApplyWitness,
    )
    const failureWitness = parseOptionalEvidence(
      optionalOwnDataValue(value, 'failureWitness', 'ReceiptRecoveryEvidence'),
      parseFailureWitness,
    )
    if (receiptIntent && !authorityMatches(receiptIntent, expectedAuthority)) return indeterminate('authority-mismatch')
    if (!receipt) {
      if (!receiptIntent && !applyWitness && !failureWitness) return freezeDto({ classification: 'missing' })
      return indeterminate('missing-durable-receipt')
    }
    if (!receiptIntent) return indeterminate('missing-receipt-intent')
    if (!authorityMatches(receipt, expectedAuthority)) return indeterminate('authority-mismatch')
    if (applyWitness && failureWitness) return indeterminate('ambiguous-witnesses')

    if (receipt.status === 'applied') {
      if (!applyWitness) return indeterminate('missing-apply-witness')
      if (failureWitness || !authorityMatches(applyWitness, expectedAuthority)) {
        return indeterminate(failureWitness ? 'ambiguous-witnesses' : 'authority-mismatch')
      }
      if (!receipt.witness || !jsonDataEqual(receipt.witness, applyWitnessReference(applyWitness))) {
        return indeterminate('witness-mismatch')
      }
      return freezeDto({ classification: 'committed', receiptIntent, receipt })
    }

    if (FAILED_RECEIPT_STATUSES.includes(receipt.status)) {
      if (applyWitness) return indeterminate('witness-mismatch')
      if (!failureWitness) return indeterminate('missing-failure-witness')
      if (!authorityMatches(failureWitness, expectedAuthority)) return indeterminate('authority-mismatch')
      if (receipt.status !== failureWitness.receiptStatus) return indeterminate('witness-mismatch')
      if (receipt.failure?.code !== failureWitness.failureCode) return indeterminate('failure-code-mismatch')
      if (!receipt.witness || !jsonDataEqual(receipt.witness, failureWitnessReference(failureWitness))) {
        return indeterminate('witness-mismatch')
      }
      return freezeDto({ classification: 'failed', receiptIntent, receipt })
    }

    return indeterminate('receipt-is-not-a-durable-outcome')
  } catch (error) {
    if (error instanceof PersistenceLineageContractError) return indeterminate('invalid-durable-evidence')
    throw error
  }
}
