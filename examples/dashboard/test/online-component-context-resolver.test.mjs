import assert from 'node:assert/strict'
import test from 'node:test'
import {
  resolveDashboardOnlineComponentContext,
  sanitizeDashboardOnlineComponentProps,
} from '../src/runtime/online-components/context-resolver.mjs'

const authorityFixture = Object.freeze({
  accessToken: 'nested-access-token',
  credentialRef: 'credential://nested',
  authorization: 'Bearer nested',
  refreshToken: 'nested-refresh-token',
  safe: 'retained',
})

test('context projection recursively strips host authority keys from every public field', () => {
  const context = resolveDashboardOnlineComponentContext({
    public: {
      level1: {
        ...authorityFixture,
        level2: [{ ...authorityFixture, value: 7 }],
      },
    },
    data: {
      rows: [{ id: 1, auth: { ...authorityFixture } }],
    },
    theme: {
      palette: { ...authorityFixture, color: '#fff' },
    },
    assets: [
      {
        id: 'asset-a',
        metadata: { ...authorityFixture, handle: 'asset://a' },
      },
    ],
  })

  assert.deepEqual(context, {
    props: {
      public: {
        level1: {
          safe: 'retained',
          level2: [{ safe: 'retained', value: 7 }],
        },
      },
    },
    data: {
      rows: [{ id: 1, auth: { safe: 'retained' } }],
    },
    theme: {
      palette: { safe: 'retained', color: '#fff' },
    },
    assets: [
      {
        id: 'asset-a',
        metadata: { safe: 'retained', handle: 'asset://a' },
      },
    ],
  })
  assert.doesNotMatch(
    JSON.stringify(context),
    /accessToken|credentialRef|authorization|refreshToken|nested-access-token|credential:\/\/nested|Bearer nested|nested-refresh-token/,
  )
})

test('authority keys are skipped without invoking accessors and remaining values retain fail-closed budgets', () => {
  let getterReads = 0
  const nested = { safe: true }
  Object.defineProperty(nested, 'authorization', {
    enumerable: true,
    get() {
      getterReads += 1
      return 'Bearer stolen'
    },
  })

  assert.deepEqual(sanitizeDashboardOnlineComponentProps({ nested }), { nested: { safe: true } })
  assert.equal(getterReads, 0)

  const overflow = resolveDashboardOnlineComponentContext({
    data: {
      nested: {
        accessToken: 'x'.repeat(50 * 1024),
        retained: 'ok',
      },
    },
    theme: { label: 'x'.repeat(50 * 1024) },
  })
  assert.deepEqual(overflow.data, { nested: { retained: 'ok' } })
  assert.deepEqual(overflow.theme, {})
})
