import assert from 'node:assert/strict'
import test from 'node:test'

test('unique IDs remain collision-free when the realm has no global Web Crypto', async () => {
  const cryptoDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
  const originalNow = Date.now
  const originalRandom = Math.random
  try {
    assert.equal(Reflect.deleteProperty(globalThis, 'crypto'), true)
    Date.now = () => 0
    Math.random = () => 0

    const { uniqueId } = await import(`../dist/index.js?without-web-crypto=${Date.now()}`)
    const ids = new Set(Array.from({ length: 10_000 }, () => uniqueId('runtime')))

    assert.equal(ids.size, 10_000)
    assert.ok([...ids].every(id => id.startsWith('runtime-')))
  } finally {
    Date.now = originalNow
    Math.random = originalRandom
    if (cryptoDescriptor) Object.defineProperty(globalThis, 'crypto', cryptoDescriptor)
  }
})
