import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'

import { canonicalJsonString } from '../src/editor/agent/capabilities/screen/contract.mjs'
import {
  createScreenPreparedHashInput,
  createScreenTransactionFingerprintInput,
  parseScreenChangeSetReceiptPayloads,
  verifyScreenReceiptIntentRecovery,
} from '../src/editor/agent/capabilities/screen/receipt-intent.mjs'

const digest = async value => `sha256:${createHash('sha256').update(canonicalJsonString(value)).digest('hex')}`

const payloads = () => {
  const affectedFieldSlots = [
    {
      nodeId: 'text-a',
      fieldId: 'props.text',
      root: 'props',
      path: ['text'],
      slotKey: 'project-a/main/text-a/props/text',
      aliases: ['project-a/main/text-a/props', 'project-a/main/text-a/props/text'],
    },
  ]
  const affectedSlotKeys = ['project-a/main/text-a/props', 'project-a/main/text-a/props/text']
  return {
    preImages: {
      schemaVersion: 1,
      kind: 'screen-change-set-pre-images',
      documentId: 'document-a',
      baseMutationVersion: 4,
      materialRegistryVersion: 9,
      manifestFingerprints: [],
      insertedNodeIdentities: [],
      operations: [{ opId: 'set-text', type: 'set', nodeId: 'text-a', fieldId: 'props.text', value: 'after' }],
      commands: [{ type: 'updateProps', documentId: 'document-a', nodeId: 'text-a', props: { text: 'after' } }],
      images: [
        {
          operationIndex: 0,
          kind: 'field',
          nodeId: 'text-a',
          fieldId: 'props.text',
          root: 'props',
          path: ['text'],
          existed: true,
          value: 'before',
        },
      ],
      inverseOperations: [
        {
          sourceOperationId: 'set-text',
          sourceOperationIndex: 0,
          operation: {
            opId: 'inverse:set-text',
            type: 'set',
            nodeId: 'text-a',
            fieldId: 'props.text',
            value: 'before',
          },
        },
      ],
      affectedFieldSlots,
      affectedStructuralSlots: [],
      affectedSlotKeys,
    },
    expectedPostImages: {
      schemaVersion: 1,
      kind: 'screen-change-set-post-images',
      documentId: 'document-a',
      images: [
        {
          operationIndex: 0,
          kind: 'field',
          nodeId: 'text-a',
          fieldId: 'props.text',
          root: 'props',
          path: ['text'],
          existed: true,
          value: 'after',
        },
      ],
      affectedFieldSlots,
      affectedStructuralSlots: [],
      affectedSlotKeys,
    },
  }
}

const lineage = async overrides => {
  const images = payloads()
  const authority = { projectId: 'project-a', branchId: 'main', callId: 'call-a' }
  const transactionFingerprint = await digest(
    createScreenTransactionFingerprintInput({ callId: authority.callId, ...images.preImages }),
  )
  const preparedHash = await digest(
    createScreenPreparedHashInput({ ...authority, baseRevision: 'revision-1', ...images }),
  )
  return {
    receiptIntent: {
      schemaVersion: 1,
      ...authority,
      preparedHash,
      baseRevision: 'revision-1',
      ...images,
      status: 'pending',
    },
    receipt: {
      schemaVersion: 1,
      ...authority,
      status: 'applied',
      witness: { schemaVersion: 1, kind: 'apply', transactionFingerprint },
    },
    ...overrides,
  }
}

test('Screen recovery recomputes both domain-separated hashes and returns the legal immutable intent', async () => {
  const input = await lineage()
  const result = await verifyScreenReceiptIntentRecovery({ ...input, hashCanonicalJson: digest })
  assert.equal(result.classification, 'verified')
  assert.deepEqual(result.receiptIntent, input.receiptIntent)
  assert.deepEqual(
    result.payloads,
    parseScreenChangeSetReceiptPayloads({
      preImages: input.receiptIntent.preImages,
      expectedPostImages: input.receiptIntent.expectedPostImages,
    }),
  )
})

test('tampered and mix-and-match Screen lineage fails closed before it can project a terminal receipt', async () => {
  const original = await lineage()
  const tampered = structuredClone(original)
  tampered.receiptIntent.expectedPostImages.images[0].value = 'attacker-value'
  assert.deepEqual(await verifyScreenReceiptIntentRecovery({ ...tampered, hashCanonicalJson: digest }), {
    classification: 'indeterminate',
    reason: 'screen-prepared-hash-mismatch',
  })

  const mixed = structuredClone(original)
  mixed.receipt.witness.transactionFingerprint = `sha256:${'f'.repeat(64)}`
  assert.deepEqual(await verifyScreenReceiptIntentRecovery({ ...mixed, hashCanonicalJson: digest }), {
    classification: 'indeterminate',
    reason: 'screen-transaction-fingerprint-mismatch',
  })
})

test('unknown fields, accessors, noncanonical order, legacy payloads, and budgets are rejected without normalization', async () => {
  for (const mutate of [
    value => {
      value.preImages.unknown = true
    },
    value => {
      value.preImages.affectedSlotKeys.reverse()
    },
    value => {
      Reflect.deleteProperty(value.preImages, 'commands')
    },
    value => {
      value.preImages.images = Array.from({ length: 10_001 }, () => value.preImages.images[0])
    },
  ]) {
    const value = payloads()
    mutate(value)
    assert.throws(() => parseScreenChangeSetReceiptPayloads(value))
  }

  let reads = 0
  const accessor = await lineage()
  Object.defineProperty(accessor.receiptIntent.preImages, 'commands', {
    enumerable: true,
    get() {
      reads += 1
      return []
    },
  })
  assert.deepEqual(await verifyScreenReceiptIntentRecovery({ ...accessor, hashCanonicalJson: digest }), {
    classification: 'indeterminate',
    reason: 'invalid-screen-receipt-intent',
  })
  assert.equal(reads, 0)

  const semanticTamper = await lineage()
  semanticTamper.receiptIntent.preImages.unknown = true
  semanticTamper.receiptIntent.preparedHash = await digest(
    createScreenPreparedHashInput({
      ...semanticTamper.receiptIntent,
      preImages: semanticTamper.receiptIntent.preImages,
      expectedPostImages: semanticTamper.receiptIntent.expectedPostImages,
    }),
  )
  assert.deepEqual(await verifyScreenReceiptIntentRecovery({ ...semanticTamper, hashCanonicalJson: digest }), {
    classification: 'indeterminate',
    reason: 'invalid-screen-receipt-intent',
  })
})
