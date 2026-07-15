import assert from 'node:assert/strict'
import test from 'node:test'
import { createRendererAdapter } from '../.test-dist/index.js'

const BaseA = class BaseA {}
const PageA = class PageA {}
const ComponentA = class ComponentA {}
const BaseB = class BaseB {}
const PageB = class PageB {}
const ComponentB = class ComponentB {}

test('renderer adapters own independent module graphs', () => {
  const first = createRendererAdapter({
    BaseRenderer: BaseA,
    PageRenderer: PageA,
    ComponentRenderer: ComponentA,
  })
  const second = createRendererAdapter({
    BaseRenderer: BaseB,
    PageRenderer: PageB,
    ComponentRenderer: ComponentB,
  })

  first.setPageRenderer(PageB)

  assert.equal(first.getRenderers().BaseRenderer, BaseA)
  assert.equal(first.getRenderers().PageRenderer, PageB)
  assert.equal(second.getRenderers().BaseRenderer, BaseB)
  assert.equal(second.getRenderers().PageRenderer, PageB)
  assert.equal(second.getRenderers().ComponentRenderer, ComponentB)
  assert.notStrictEqual(first.getRenderers(), second.getRenderers())
})

test('an empty renderer adapter does not share later configuration', () => {
  const first = createRendererAdapter()
  const second = createRendererAdapter()

  first.setRenderers({ PageRenderer: PageA, ComponentRenderer: ComponentA })

  assert.equal(first.getRenderers().PageRenderer, PageA)
  assert.deepEqual(second.getRenderers(), {})
})
