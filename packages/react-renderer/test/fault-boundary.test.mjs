import assert from 'node:assert/strict'
import test from 'node:test'
import { Component } from 'react'

globalThis.location = { href: '?__logConf__=error:test-silent' }
const { compWrapper } = await import('../.test-dist/index.js')

test('component error boundaries pass the canonical node schema to the fault component', () => {
  const schema = {
    componentName: 'BrokenMaterial',
    id: 'broken-material',
    props: {},
    $dashboard: {
      rect: { x: 10, y: 20, width: 300, height: 200 },
    },
  }
  const observed = []
  const engine = {
    createElement(_component, props) {
      observed.push(props)
      return props
    },
    getFaultComponent() {
      return () => null
    },
  }

  class BrokenMaterial extends Component {
    render() {
      return null
    }
  }

  const Wrapped = compWrapper(BrokenMaterial, {
    baseRenderer: { context: { engine } },
    schema,
  })
  const instance = new Wrapped({
    __schema: schema,
    _componentName: schema.componentName,
  })
  instance.state = {
    engineRenderError: true,
    error: new Error('original render failure'),
  }

  const faultProps = instance.render()

  assert.equal(faultProps.schema, schema)
  assert.equal(faultProps.error.message, 'original render failure')
  assert.equal(observed.length, 1)
})
