import assert from 'node:assert/strict'
import test from 'node:test'

import { DataHelper, PolicyViolation, legacyTrustedExpressionEvaluator } from '../.test-dist/index.js'

const jsFunction = value => ({ type: 'JSFunction', value })

const createDataHelper = expressionEvaluator =>
  new DataHelper(
    {},
    {
      list: [
        {
          id: 'users',
          type: 'fetch',
          isInit: true,
          options: { uri: 'https://example.test/users' },
          dataHandler: jsFunction('data => data'),
        },
      ],
    },
    { expressionEvaluator },
    value => value,
  )

const settleWithin = promise => {
  let timeout
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(() => reject(new Error('DataHelper did not settle')), 100)
  })

  return Promise.race([promise, deadline]).finally(() => clearTimeout(timeout))
}

const nextTurn = () => new Promise(resolve => setImmediate(resolve))

const exerciseRejectedPreflight = async (expressionEvaluator, assertViolation) => {
  const originalFetch = globalThis.fetch
  const unhandledRejections = []
  let requestCount = 0
  const onUnhandledRejection = reason => unhandledRejections.push(reason)

  globalThis.fetch = async () => {
    requestCount += 1
    return {
      status: 200,
      json: async () => ({ id: 1 }),
    }
  }
  process.on('unhandledRejection', onUnhandledRejection)

  try {
    const helper = createDataHelper(expressionEvaluator)

    await assert.rejects(settleWithin(helper.getInitData()), assertViolation)
    await nextTurn()

    assert.equal(requestCount, 0)
    assert.equal(helper.dataSourceMap.users.status, 'init')
    assert.deepEqual(unhandledRejections, [])
  } finally {
    process.off('unhandledRejection', onUnhandledRejection)
    globalThis.fetch = originalFetch
  }
}

test('DataHelper rejects a missing evaluator before datasource request side effects', async () => {
  await exerciseRejectedPreflight(undefined, error => {
    assert.ok(error instanceof PolicyViolation)
    assert.equal(error.reason, 'missing-evaluator')
    assert.equal(error.policy, 'missing')
    return true
  })
})

test('DataHelper preserves a denied evaluator violation without an unhandled rejection', async () => {
  let originalViolation
  const expressionEvaluator = {
    policy: 'test-deny',
    evaluate(request) {
      originalViolation = new PolicyViolation({
        message: 'datasource handlers are denied',
        request,
        reason: 'policy-denied',
        policy: 'test-deny',
      })
      throw originalViolation
    },
  }

  await exerciseRejectedPreflight(expressionEvaluator, error => {
    assert.strictEqual(error, originalViolation)
    return true
  })
})

test('DataHelper settles rejected requests through the precompiled data handler', async () => {
  const originalFetch = globalThis.fetch
  const requestError = new Error('network unavailable')
  const unhandledRejections = []
  const onUnhandledRejection = reason => unhandledRejections.push(reason)

  globalThis.fetch = async () => {
    throw requestError
  }
  process.on('unhandledRejection', onUnhandledRejection)

  try {
    const helper = new DataHelper(
      {},
      {
        list: [
          {
            id: 'users',
            type: 'fetch',
            isInit: true,
            options: { uri: 'https://example.test/users' },
            dataHandler: jsFunction('(data, error) => error.message'),
          },
        ],
      },
      { expressionEvaluator: legacyTrustedExpressionEvaluator },
      value => value,
    )

    assert.deepEqual(await settleWithin(helper.getInitData()), { users: 'network unavailable' })
    await nextTurn()

    assert.equal(helper.dataSourceMap.users.status, 'error')
    assert.strictEqual(helper.dataSourceMap.users.error, requestError)
    assert.deepEqual(unhandledRejections, [])
  } finally {
    process.off('unhandledRejection', onUnhandledRejection)
    globalThis.fetch = originalFetch
  }
})
