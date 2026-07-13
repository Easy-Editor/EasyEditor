import assert from 'node:assert/strict'
import test from 'node:test'

import { dashboardJsxRuntime } from '../src/jsx-runtime-global.mjs'

test('Dashboard exposes the automatic JSX runtime contract to remote UMD modules', () => {
  const element = dashboardJsxRuntime.jsx('span', { children: 'hello' }, 'stable-key')

  assert.equal(element.key, 'stable-key')
  assert.equal(element.props.children, 'hello')
  assert.strictEqual(dashboardJsxRuntime.Fragment, Symbol.for('react.fragment'))
})
