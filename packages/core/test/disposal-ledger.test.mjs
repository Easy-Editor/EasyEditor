import assert from 'node:assert/strict'
import test from 'node:test'

import { DisposalError, DisposalLedger } from '../dist/index.js'

const deferred = () => {
  let resolve
  const promise = new Promise(done => {
    resolve = done
  })
  return { promise, resolve }
}

test('concurrent dispose callers join one reverse-order cleanup attempt', async () => {
  const ledger = new DisposalLedger()
  const gate = deferred()
  const order = []

  ledger.add(() => order.push('first'), 'first')
  ledger.add(async () => {
    order.push('second:start')
    await gate.promise
    order.push('second:end')
  }, 'second')

  let firstSettled = false
  let secondSettled = false
  const first = ledger.dispose().finally(() => {
    firstSettled = true
  })
  const second = ledger.dispose().finally(() => {
    secondSettled = true
  })

  await Promise.resolve()
  assert.deepEqual(order, ['second:start'])
  assert.equal(firstSettled, false)
  assert.equal(secondSettled, false)

  gate.resolve()
  await Promise.all([first, second])

  assert.deepEqual(order, ['second:start', 'second:end', 'first'])
  assert.equal(ledger.isDisposed, true)
})

test('failed cleanup remains retryable without repeating successful cleanup', async () => {
  const ledger = new DisposalLedger()
  let stableCalls = 0
  let flakyCalls = 0

  ledger.add(() => {
    stableCalls += 1
  }, 'stable')
  ledger.add(() => {
    flakyCalls += 1
    if (flakyCalls === 1) throw new Error('temporary failure')
  }, 'flaky')

  await assert.rejects(
    ledger.dispose(),
    error =>
      error instanceof DisposalError &&
      error.failures.length === 1 &&
      error.failures[0]?.label === 'flaky' &&
      error.failures[0]?.cause instanceof Error,
  )

  assert.equal(ledger.isDisposed, false)
  assert.equal(stableCalls, 1)
  assert.equal(flakyCalls, 1)
  assert.throws(() => ledger.add(() => {}, 'late'), /Cannot register/)

  await ledger.dispose()

  assert.equal(stableCalls, 1)
  assert.equal(flakyCalls, 2)
  assert.equal(ledger.isDisposed, true)
})

test('rollback preserves failed post-checkpoint entries for a later retry', async () => {
  const ledger = new DisposalLedger()
  const order = []
  let flakyCalls = 0

  ledger.add(() => order.push('base'), 'base')
  const checkpoint = ledger.checkpoint()
  ledger.add(() => order.push('successful'), 'successful')
  ledger.add(() => {
    flakyCalls += 1
    order.push(`flaky:${flakyCalls}`)
    if (flakyCalls === 1) throw new Error('retry me')
  }, 'flaky')

  await assert.rejects(ledger.rollback(checkpoint), DisposalError)
  assert.deepEqual(order, ['flaky:1', 'successful'])

  await ledger.rollback(checkpoint)
  assert.deepEqual(order, ['flaky:1', 'successful', 'flaky:2'])

  await ledger.dispose()
  assert.deepEqual(order, ['flaky:1', 'successful', 'flaky:2', 'base'])
})
