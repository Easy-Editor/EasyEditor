import assert from 'node:assert/strict'
import test from 'node:test'

import DashboardPlugin, { AlignType, Alignment, DistributeType, GuideLine, createEngine } from '../.test-dist/index.js'

const VIEWPORT_MOUNT = 'simulator:viewport.mount'
const INSERT_NODE_BEFORE = 'designer:node.insert.before'

const createRect = (x, y, width, height) => ({
  x,
  y,
  width,
  height,
  left: x,
  top: y,
  right: x + width,
  bottom: y + height,
})

const createNode = ({ id, x, y, width, height, isGroup = false, isRoot = false, children = [] }) => {
  let currentRect = createRect(x, y, width, height)
  const updates = []
  return {
    id,
    isGroup,
    isRoot,
    getAllNodesInGroup: () => children,
    getDashboardRect: () => currentRect,
    updateDashboardRect(update) {
      updates.push(update)
      currentRect = createRect(
        update.x ?? currentRect.x,
        update.y ?? currentRect.y,
        update.width ?? currentRect.width,
        update.height ?? currentRect.height,
      )
    },
    updates,
  }
}

const flattenErrors = error => {
  if (!(error instanceof AggregateError)) return [error]
  return error.errors.flatMap(flattenErrors)
}

const errorMessages = error =>
  flattenErrors(error)
    .map(item => String(item?.message ?? item))
    .join('\n')

const createDesigner = (DesignerClass = class {}, options = {}) => {
  const registered = []
  const disposed = []
  const disposeFailures = new Map(options.disposeFailures ?? [])

  const register = (kind, name, listener) => {
    const registration = { active: true, kind, listener, name }
    registered.push(registration)
    return () => {
      if (!registration.active) return
      const key = `${kind}:${name}`
      const failuresRemaining = disposeFailures.get(key) ?? 0
      if (failuresRemaining > 0) {
        disposeFailures.set(key, failuresRemaining - 1)
        throw new Error(`dispose fault: ${key}`)
      }
      registration.active = false
      disposed.push(key)
    }
  }

  const designer = Object.assign(new DesignerClass(), {
    currentDocument: { nodesMap: new Map() },
    detecting: { enable: true },
    editor: {
      get: key =>
        key === 'engine'
          ? { lifecycleState: 'ready', plugins: { has: pluginName => pluginName === 'DashboardPlugin' } }
          : undefined,
    },
    project: { documents: [] },
    selection: {
      getNodes: () => [],
      getTopNodes: () => [],
    },
    dragon: {
      onDragstart: listener => register('dragon', 'dragstart', listener),
      onDrag: listener => register('dragon', 'drag', listener),
      onDragend: listener => register('dragon', 'dragend', listener),
    },
    onEvent: (name, listener) => register('designer', name, listener),
  })
  const capability = new Proxy(designer, {
    get(target, property) {
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  const emit = (name, payload) => {
    const errors = []
    for (const registration of registered) {
      if (!registration.active || registration.name !== name) continue
      try {
        registration.listener(payload)
      } catch (error) {
        errors.push(error)
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, `fake designer event failed: ${name}`)
  }

  return { capability, designer, disposed, emit, registered }
}

const preparePlugin = () => {
  const meta = { componentName: 'Group' }
  const initSchema = { componentName: 'Group', isGroup: true }
  const plugin = DashboardPlugin({ group: { meta, initSchema } })
  const extensions = new Map()

  class FakeNode {
    initBuiltinProps() {}
  }
  class FakeDesigner {}

  plugin.extend({
    extendClass: { Node: FakeNode },
    extend(name, descriptors) {
      extensions.set(name, descriptors)
      if (name === 'Designer') Object.defineProperties(FakeDesigner.prototype, descriptors)
    },
  })

  return { DesignerClass: FakeDesigner, extensions, initSchema, meta, plugin }
}

const initializeFakePlugin = (plugin, target, meta) => {
  const registeredDisposers = []
  const createdMetadata = []
  plugin.init({
    materials: { createComponentMeta: value => createdMetadata.push(value) },
    project: { designer: target.capability },
    onDispose(disposer) {
      registeredDisposers.push(disposer)
      return disposer
    },
  })
  assert.deepEqual(createdMetadata, [meta])
  return registeredDisposers
}

test('dashboard plugin owns listeners and invalidates disposed per-designer helpers', () => {
  assert.throws(() => DashboardPlugin(), /group meta and group init schema are required/)

  const { DesignerClass, extensions, initSchema, meta, plugin } = preparePlugin()
  assert.equal(plugin.name, 'DashboardPlugin')
  assert.equal(plugin.extensionFingerprint, `DashboardPlugin:v1:${JSON.stringify(initSchema)}`)

  const first = createDesigner(DesignerClass)
  const second = createDesigner(DesignerClass)
  const designerExtensions = extensions.get('Designer')
  const getGuideline = designer => designerExtensions.guideline.get.call(designer)
  const getAlignment = designer => designerExtensions.alignment.get.call(designer)
  const getMarquee = designer => designerExtensions.marqueeSelection.get.call(designer)

  for (const getHelper of [getGuideline, getAlignment, getMarquee]) {
    assert.throws(() => getHelper(first.designer), /runtime is not active/)
    assert.throws(() => getHelper(second.designer), /runtime is not active/)
  }

  const registeredDisposers = initializeFakePlugin(plugin, first, meta)
  assert.equal(first.registered.filter(item => item.kind === 'dragon' && item.active).length, 4)
  assert.equal(first.registered.filter(item => item.name === INSERT_NODE_BEFORE && item.active).length, 1)
  assert.equal(registeredDisposers.length, 6, 'five listeners plus helper cleanup must be owned')

  const activeGuideline = getGuideline(first.designer)
  const activeAlignment = getAlignment(first.designer)
  const activeMarquee = getMarquee(first.designer)
  assert.equal(getGuideline(first.designer), activeGuideline)
  assert.equal(getAlignment(first.designer), activeAlignment)
  assert.equal(getMarquee(first.designer), activeMarquee)
  for (const getHelper of [getGuideline, getAlignment, getMarquee]) {
    assert.throws(() => getHelper(second.designer), /runtime is not active/)
  }
  first.emit(VIEWPORT_MOUNT, { viewport: { height: 300, width: 400 } })
  assert.equal(activeGuideline.guideLines.length, 6)

  for (const disposer of [...registeredDisposers].reverse()) disposer()
  assert.equal(first.registered.filter(item => item.active).length, 0)
  assert.equal(activeGuideline.guideLines.length, 0)
  const registrationsAfterDispose = first.registered.length
  for (const getHelper of [getGuideline, getAlignment, getMarquee]) {
    assert.throws(() => getHelper(first.designer), /runtime is not active/)
  }
  assert.equal(first.registered.length, registrationsAfterDispose, 'inactive getters must not allocate leaked helpers')

  const restartedDisposers = initializeFakePlugin(plugin, first, meta)
  const restartedGuideline = getGuideline(first.designer)
  assert.notEqual(restartedGuideline, activeGuideline)
  assert.notEqual(getAlignment(first.designer), activeAlignment)
  assert.notEqual(getMarquee(first.designer), activeMarquee)
  registeredDisposers[0]()
  assert.equal(
    getGuideline(first.designer),
    restartedGuideline,
    'a stale disposer must not revoke a newer runtime lease',
  )
  first.emit(VIEWPORT_MOUNT, { viewport: { height: 300, width: 400 } })
  assert.equal(restartedGuideline.guideLines.length, 6)
  assert.equal(activeGuideline.guideLines.length, 0, 'the unloaded helper must not observe the restarted runtime')

  for (const disposer of [...restartedDisposers].reverse()) disposer()
  assert.equal(first.registered.filter(item => item.active).length, 0)
})

test('public helper disposal evicts runtime caches without exposing engine teardown policy', () => {
  const { DesignerClass, extensions, meta, plugin } = preparePlugin()
  const target = createDesigner(DesignerClass)
  const registeredDisposers = initializeFakePlugin(plugin, target, meta)
  const designerExtensions = extensions.get('Designer')
  const getGuideline = () => designerExtensions.guideline.get.call(target.designer)
  const getMarquee = () => designerExtensions.marqueeSelection.get.call(target.designer)

  const firstGuideline = getGuideline()
  firstGuideline.dispose()
  const replacementGuideline = getGuideline()
  assert.notEqual(replacementGuideline, firstGuideline)

  const firstMarquee = getMarquee()
  firstMarquee.dispose()
  const replacementMarquee = getMarquee()
  assert.notEqual(replacementMarquee, firstMarquee)

  for (const disposer of [...registeredDisposers].reverse()) disposer()
  assert.throws(() => getGuideline(), /runtime is not active/)
  assert.throws(() => getMarquee(), /runtime is not active/)
})

test('dashboard runtime activation rolls back atomically when disposal registration fails', () => {
  const { DesignerClass, extensions, meta, plugin } = preparePlugin()
  const target = createDesigner(DesignerClass, {
    disposeFailures: [[`designer:${VIEWPORT_MOUNT}`, 1]],
  })
  const getGuideline = () => extensions.get('Designer').guideline.get.call(target.designer)
  let retryRuntimeCleanup
  let registrationFailure

  try {
    plugin.init({
      materials: { createComponentMeta: () => assert.fail('metadata must not be registered after ownership failure') },
      project: { designer: target.capability },
      onDispose(disposer) {
        retryRuntimeCleanup = disposer
        getGuideline()
        throw new Error('runtime ownership registry fault')
      },
    })
  } catch (error) {
    registrationFailure = error
  }

  assert.ok(registrationFailure instanceof AggregateError)
  assert.match(errorMessages(registrationFailure), /runtime ownership registry fault/)
  assert.match(errorMessages(registrationFailure), /dispose fault: designer:simulator:viewport.mount/)
  assert.throws(() => getGuideline(), /runtime is not active/)
  assert.equal(target.registered.filter(item => item.active).length, 1, 'failed cleanup remains retryable')
  retryRuntimeCleanup()
  assert.equal(target.registered.filter(item => item.active).length, 0)
})

test('dashboard runtime cleanup aggregates helper failures and retries retained caches', () => {
  const { DesignerClass, extensions, meta, plugin } = preparePlugin()
  const target = createDesigner(DesignerClass, {
    disposeFailures: [[`designer:${VIEWPORT_MOUNT}`, 1]],
  })
  const designerExtensions = extensions.get('Designer')
  const registeredDisposers = initializeFakePlugin(plugin, target, meta)
  const runtimeCleanup = registeredDisposers[0]
  const guideline = designerExtensions.guideline.get.call(target.designer)
  const alignment = designerExtensions.alignment.get.call(target.designer)
  const marquee = designerExtensions.marqueeSelection.get.call(target.designer)
  const shell = new FakeEventTarget({ failRemoveAt: [1] })
  marquee.from(shell, { toLocalPoint: event => event }, () => false)

  let firstFailure
  try {
    runtimeCleanup()
  } catch (error) {
    firstFailure = error
  }
  assert.ok(firstFailure instanceof AggregateError)
  assert.match(errorMessages(firstFailure), /dispose fault: designer:simulator:viewport.mount/)
  assert.match(errorMessages(firstFailure), /remove fault: mousedown/)
  assert.throws(() => designerExtensions.guideline.get.call(target.designer), /runtime is not active/)
  assert.throws(() => designerExtensions.marqueeSelection.get.call(target.designer), /runtime is not active/)
  assert.throws(() => designerExtensions.alignment.get.call(target.designer), /runtime is not active/)
  assert.equal(target.registered.filter(item => item.name === VIEWPORT_MOUNT && item.active).length, 1)
  assert.equal(shell.listenerCount('mousedown'), 1)

  runtimeCleanup()
  assert.equal(target.registered.filter(item => item.name === VIEWPORT_MOUNT && item.active).length, 0)
  assert.equal(shell.listenerCount('mousedown'), 0)
  for (const getHelper of [
    designerExtensions.guideline.get,
    designerExtensions.marqueeSelection.get,
    designerExtensions.alignment.get,
  ]) {
    assert.throws(() => getHelper.call(target.designer), /runtime is not active/)
  }
  runtimeCleanup()
  for (const disposer of registeredDisposers.slice(1).reverse()) disposer()

  const restartedDisposers = initializeFakePlugin(plugin, target, meta)
  assert.notEqual(designerExtensions.guideline.get.call(target.designer), guideline)
  assert.notEqual(designerExtensions.marqueeSelection.get.call(target.designer), marquee)
  assert.notEqual(designerExtensions.alignment.get.call(target.designer), alignment)
  for (const disposer of [...restartedDisposers].reverse()) disposer()
})

test('alignment excludes roots, moves group children, and distributes in geometry order', () => {
  const root = createNode({ id: 'root', x: -100, y: -100, width: 1, height: 1, isRoot: true })
  const child = createNode({ id: 'child', x: 55, y: 25, width: 5, height: 5 })
  const group = createNode({ id: 'group', x: 50, y: 20, width: 20, height: 20, isGroup: true, children: [child] })
  const plain = createNode({ id: 'plain', x: 10, y: 80, width: 10, height: 10 })
  const alignment = new Alignment({ selection: { getTopNodes: () => [root, group, plain] } })

  assert.equal(alignment.align(AlignType.LEFT), true)
  assert.deepEqual(child.getDashboardRect(), createRect(15, 25, 5, 5))
  assert.deepEqual(plain.getDashboardRect(), createRect(10, 80, 10, 10))
  assert.deepEqual(root.updates, [])

  const left = createNode({ id: 'left', x: 0, y: 0, width: 10, height: 10 })
  const middle = createNode({ id: 'middle', x: 40, y: 10, width: 20, height: 10 })
  const right = createNode({ id: 'right', x: 100, y: 20, width: 10, height: 10 })
  const distribution = new Alignment({ selection: { getTopNodes: () => [right, left, middle] } })

  assert.equal(distribution.distribute(DistributeType.HORIZONTAL), true)
  assert.equal(left.getDashboardRect().x, 0)
  assert.equal(middle.getDashboardRect().x, 45)
  assert.equal(right.getDashboardRect().x, 100)

  const insufficient = new Alignment({ selection: { getTopNodes: () => [root, plain] } })
  assert.equal(insufficient.align(AlignType.TOP), false)
  assert.equal(insufficient.distribute(DistributeType.VERTICAL), false)
})

test('guidelines register viewport geometry, snap to user lines, and retry disposal', () => {
  const target = createDesigner(class {}, {
    disposeFailures: [[`designer:${VIEWPORT_MOUNT}`, 1]],
  })
  const guideline = new GuideLine(target.designer)

  target.emit(VIEWPORT_MOUNT, { viewport: { height: 300, width: 400 } })
  assert.deepEqual([...guideline.guideLinesMap.verticalLinesMap.keys()], [0, 200, 400])
  assert.deepEqual([...guideline.guideLinesMap.horizontalLinesMap.keys()], [0, 150, 300])

  const vertical = guideline.addUserGuideLine('vertical', 99.6)
  const horizontal = guideline.addUserGuideLine('horizontal', 79.6)
  assert.deepEqual(vertical, { id: 'user-guideline-1', type: 'vertical', position: 100 })
  assert.deepEqual(horizontal, { id: 'user-guideline-2', type: 'horizontal', position: 80 })

  guideline.updateUserGuideLine(vertical.id, 100.4)
  assert.equal(guideline.userGuideLinesMap.verticalLinesMap.get(100).id, vertical.id)
  const result = guideline.getAdsorptionPosition(createRect(94, 74, 20, 20), 0)
  assert.equal(result.isAdsorption, true)
  assert.deepEqual(result.adsorb.x, { adsorption: 0, position: 100 })
  assert.deepEqual(result.adsorb.y, { adsorption: 0, position: 80 })

  assert.throws(() => guideline.dispose(), AggregateError)
  assert.equal(guideline.guideLines.length, 0)
  target.emit(VIEWPORT_MOUNT, { viewport: { height: 500, width: 600 } })
  assert.equal(guideline.guideLines.length, 0, 'a helper being disposed must make a stale listener inert')
  guideline.dispose()
  guideline.dispose()
  assert.equal(target.registered.filter(item => item.active).length, 0)
})

class FakeEventTarget {
  constructor({ failAddAt = [], failRemoveAt = [] } = {}) {
    this.addCalls = 0
    this.failAddAt = new Set(failAddAt)
    this.failRemoveAt = new Set(failRemoveAt)
    this.listeners = new Map()
    this.removeCalls = 0
    this.removeAttempts = []
  }

  addEventListener(name, listener) {
    this.addCalls += 1
    if (this.failAddAt.delete(this.addCalls)) throw new Error(`add fault: ${name}`)
    const listeners = this.listeners.get(name) ?? new Set()
    listeners.add(listener)
    this.listeners.set(name, listeners)
  }

  removeEventListener(name, listener) {
    this.removeCalls += 1
    this.removeAttempts.push(name)
    if (this.failRemoveAt.delete(this.removeCalls)) throw new Error(`remove fault: ${name}`)
    this.listeners.get(name)?.delete(listener)
  }

  emit(name, event) {
    for (const listener of [...(this.listeners.get(name) ?? [])]) listener(event)
  }

  listenerCount(name) {
    return this.listeners.get(name)?.size ?? 0
  }
}

const createMouseEvent = (overrides = {}) => {
  let defaultPrevented = false
  return {
    button: 0,
    clientX: 0,
    clientY: 0,
    ctrlKey: false,
    metaKey: false,
    target: {},
    preventDefault() {
      defaultPrevented = true
    },
    get defaultPrevented() {
      return defaultPrevented
    },
    ...overrides,
  }
}

const withFakeWindow = async run => {
  const previousWindow = globalThis.window
  const topDocument = new FakeEventTarget()
  globalThis.window = { document: topDocument }
  try {
    await run(topDocument)
  } finally {
    if (previousWindow === undefined) globalThis.window = undefined
    else globalThis.window = previousWindow
  }
}

const createMarqueeFixture = (topDocument, sensorDocument = new FakeEventTarget()) => {
  const { DesignerClass, extensions, meta, plugin } = preparePlugin()
  const target = createDesigner(DesignerClass)
  target.designer.project.documents = [
    { opened: true, simulator: { contentDocument: sensorDocument, sensorAvailable: true } },
  ]
  const registeredDisposers = initializeFakePlugin(plugin, target, meta)
  const marquee = extensions.get('Designer').marqueeSelection.get.call(target.designer)
  const shell = new FakeEventTarget()
  const viewport = { toLocalPoint: event => ({ clientX: event.clientX, clientY: event.clientY }) }
  const disposeRuntime = () => {
    for (const disposer of [...registeredDisposers].reverse()) disposer()
  }
  return { ...target, disposeRuntime, marquee, sensorDocument, shell, topDocument, viewport }
}

test('marquee selection owns cross-document listeners and active bindings', async () => {
  await withFakeWindow(topDocument => {
    const fixture = createMarqueeFixture(topDocument)
    const { designer, marquee, sensorDocument, shell, viewport } = fixture
    const nodeTarget = {}
    const starts = []
    const moves = []
    const ends = []
    marquee.onMarqueeStart(event => starts.push(event))
    marquee.onMarquee(event => moves.push(event))
    marquee.onMarqueeEnd(event => ends.push(event))

    const disposeBinding = marquee.from(shell, viewport, target => target === nodeTarget)
    const ignored = createMouseEvent({ button: 1, target: nodeTarget })
    shell.emit('mousedown', ignored)
    assert.equal(starts.length, 0)
    assert.equal(ignored.defaultPrevented, false)

    const start = createMouseEvent({ clientX: 20, clientY: 30, ctrlKey: true, view: { document: topDocument } })
    shell.emit('mousedown', start)
    assert.equal(start.defaultPrevented, true)
    assert.equal(marquee.isSelecting(), true)
    assert.equal(designer.detecting.enable, false)
    assert.deepEqual(starts[0].rect, { x: 20, y: 30, width: 0, height: 0 })
    assert.equal(topDocument.listenerCount('mousemove'), 1)
    assert.equal(sensorDocument.listenerCount('mouseup'), 1)

    topDocument.emit(
      'mousemove',
      createMouseEvent({ clientX: 5, clientY: 50, metaKey: true, view: { document: topDocument } }),
    )
    assert.deepEqual(moves[0].rect, { x: 5, y: 30, width: 15, height: 20 })
    disposeBinding()
    assert.equal(marquee.isSelecting(), false)
    assert.equal(designer.detecting.enable, true)
    assert.equal(shell.listenerCount('mousedown'), 0)
    assert.equal(topDocument.listenerCount('mousemove'), 0)
    assert.equal(sensorDocument.listenerCount('mouseup'), 0)

    const disposeCompletedBinding = marquee.from(shell, viewport, () => false)
    shell.emit('mousedown', createMouseEvent({ clientX: 20, clientY: 30, view: { document: topDocument } }))
    shell.emit('mousedown', createMouseEvent({ clientX: 25, clientY: 35, view: { document: topDocument } }))
    assert.equal(starts.length, 2, 'an active selection must not create duplicate document bindings')
    sensorDocument.emit('mouseup', createMouseEvent({ clientX: 40, clientY: 10, view: { document: sensorDocument } }))
    assert.deepEqual(ends[0].rect, { x: 20, y: 10, width: 20, height: 20 })
    disposeCompletedBinding()

    const disposeFailingBinding = marquee.from(shell, viewport, () => false)
    const unsubscribeFailingStart = marquee.onMarqueeStart(() => {
      throw new Error('start observer failed')
    })
    let startFailure
    try {
      shell.emit('mousedown', createMouseEvent({ clientX: 1, clientY: 2, view: { document: topDocument } }))
    } catch (error) {
      startFailure = error
    }
    assert.match(errorMessages(startFailure), /start observer failed/)
    assert.equal(marquee.isSelecting(), false)
    assert.equal(designer.detecting.enable, true)
    assert.equal(topDocument.listenerCount('mousemove'), 0)
    assert.equal(sensorDocument.listenerCount('mouseup'), 0)
    unsubscribeFailingStart()
    disposeFailingBinding()
    marquee.dispose()
    assert.throws(() => marquee.from(shell, viewport, () => false), /disposed/)
    fixture.disposeRuntime()
  })
})

test('marquee listener registration rolls back every successful cross-document add', async () => {
  await withFakeWindow(topDocument => {
    const sensorDocument = new FakeEventTarget({ failAddAt: [1] })
    const { designer, disposeRuntime, marquee, shell, viewport } = createMarqueeFixture(topDocument, sensorDocument)
    const disposeBinding = marquee.from(shell, viewport, () => false)

    assert.throws(
      () => shell.emit('mousedown', createMouseEvent({ view: { document: topDocument } })),
      /Failed to register marquee document listeners/,
    )
    assert.equal(marquee.isSelecting(), false)
    assert.equal(designer.detecting.enable, true)
    assert.equal(topDocument.listenerCount('mousemove'), 0)
    assert.equal(topDocument.listenerCount('mouseup'), 0)
    assert.equal(sensorDocument.listenerCount('mousemove'), 0)
    disposeBinding()
    marquee.dispose()
    disposeRuntime()
  })
})

test('marquee detecting-state read failures do not register cross-document listeners', async () => {
  await withFakeWindow(topDocument => {
    const fixture = createMarqueeFixture(topDocument)
    const { designer, marquee, sensorDocument, shell, viewport } = fixture
    Object.defineProperty(designer.detecting, 'enable', {
      configurable: true,
      get() {
        throw new Error('detecting read fault')
      },
    })
    const disposeBinding = marquee.from(shell, viewport, () => false)

    let detectingReadFailure
    try {
      shell.emit('mousedown', createMouseEvent({ view: { document: topDocument } }))
    } catch (error) {
      detectingReadFailure = error
    }
    assert.match(errorMessages(detectingReadFailure), /detecting read fault/)
    assert.equal(marquee.isSelecting(), false)
    assert.equal(topDocument.listenerCount('mousemove'), 0)
    assert.equal(topDocument.listenerCount('mouseup'), 0)
    assert.equal(sensorDocument.listenerCount('mousemove'), 0)
    assert.equal(sensorDocument.listenerCount('mouseup'), 0)

    disposeBinding()
    assert.equal(shell.listenerCount('mousedown'), 0)
    marquee.dispose()
    fixture.disposeRuntime()
  })
})

test('marquee removal faults are aggregated, state is restored, and retained listeners retry', async () => {
  await withFakeWindow(() => {
    const topDocument = globalThis.window.document
    topDocument.failRemoveAt.add(1)
    const { designer, disposeRuntime, marquee, sensorDocument, shell, viewport } = createMarqueeFixture(topDocument)
    const ends = []
    marquee.onMarqueeEnd(event => ends.push(event))
    const disposeBinding = marquee.from(shell, viewport, () => false)
    shell.emit('mousedown', createMouseEvent({ clientX: 10, clientY: 10, view: { document: topDocument } }))

    assert.throws(
      () => sensorDocument.emit('mouseup', createMouseEvent({ clientX: 20, clientY: 30 })),
      /Failed while completing marquee selection/,
    )
    assert.equal(marquee.isSelecting(), false)
    assert.equal(designer.detecting.enable, true)
    assert.equal(ends.length, 1, 'observer delivery continues even when one listener removal fails')
    assert.equal(topDocument.listenerCount('mousemove'), 1)
    assert.equal(topDocument.listenerCount('mouseup'), 0)
    assert.equal(sensorDocument.listenerCount('mousemove'), 0)
    assert.equal(sensorDocument.listenerCount('mouseup'), 0)
    assert.deepEqual(topDocument.removeAttempts, ['mousemove', 'mouseup'])

    disposeBinding()
    assert.equal(topDocument.listenerCount('mousemove'), 0)
    marquee.dispose()
    disposeRuntime()
  })
})

test('marquee coordinate and observer failures abort active selection without leaks', async () => {
  await withFakeWindow(topDocument => {
    const fixture = createMarqueeFixture(topDocument)
    const { designer, marquee, sensorDocument, shell } = fixture
    let coordinateCalls = 0
    const viewport = {
      toLocalPoint(event) {
        coordinateCalls += 1
        if (coordinateCalls === 2) throw new Error('toLocalPoint fault')
        return { clientX: event.clientX, clientY: event.clientY }
      },
    }
    const disposeBinding = marquee.from(shell, viewport, () => false)
    shell.emit('mousedown', createMouseEvent({ view: { document: topDocument } }))
    let coordinateFailure
    try {
      topDocument.emit('mousemove', createMouseEvent({ view: { document: topDocument } }))
    } catch (error) {
      coordinateFailure = error
    }
    assert.match(errorMessages(coordinateFailure), /toLocalPoint fault/)
    assert.equal(marquee.isSelecting(), false)
    assert.equal(designer.detecting.enable, true)
    assert.equal(topDocument.listenerCount('mousemove'), 0)
    assert.equal(sensorDocument.listenerCount('mouseup'), 0)

    const unsubscribeMove = marquee.onMarquee(() => {
      throw new Error('move observer fault')
    })
    coordinateCalls = 0
    shell.emit('mousedown', createMouseEvent({ view: { document: topDocument } }))
    coordinateCalls = 0
    let observerFailure
    try {
      topDocument.emit('mousemove', createMouseEvent({ view: { document: topDocument } }))
    } catch (error) {
      observerFailure = error
    }
    assert.match(errorMessages(observerFailure), /move observer fault/)
    assert.equal(marquee.isSelecting(), false)
    assert.equal(topDocument.listenerCount('mousemove'), 0)
    unsubscribeMove()
    disposeBinding()
    marquee.dispose()
    fixture.disposeRuntime()
  })
})

test('marquee instance disposal tracks bindings and retries failed shell cleanup', async () => {
  await withFakeWindow(topDocument => {
    const { designer, disposeRuntime, marquee, viewport } = createMarqueeFixture(topDocument)
    const shell = new FakeEventTarget({ failRemoveAt: [1] })
    const disposeBinding = marquee.from(shell, viewport, () => false)
    shell.emit('mousedown', createMouseEvent({ view: { document: topDocument } }))
    assert.equal(designer.detecting.enable, false)

    assert.throws(() => marquee.dispose(), /Failed to dispose marquee selection/)
    assert.equal(designer.detecting.enable, true, 'standalone disposal still restores the prior detecting state')
    shell.emit('mousedown', createMouseEvent({ view: { document: topDocument } }))
    assert.equal(topDocument.listenerCount('mousemove'), 0, 'a failed shell removal must leave an inert callback')
    marquee.dispose()
    marquee.dispose()
    disposeBinding()
    assert.equal(shell.listenerCount('mousedown'), 0)
    disposeRuntime()

    const retryFixture = createMarqueeFixture(topDocument)
    let detectingEnabled = true
    let restoreFailures = 1
    Object.defineProperty(retryFixture.designer.detecting, 'enable', {
      configurable: true,
      get: () => detectingEnabled,
      set(value) {
        if (value && restoreFailures > 0) {
          restoreFailures -= 1
          throw new Error('detecting restore fault')
        }
        detectingEnabled = value
      },
    })
    const retryBinding = retryFixture.marquee.from(retryFixture.shell, retryFixture.viewport, () => false)
    retryFixture.shell.emit('mousedown', createMouseEvent({ view: { document: topDocument } }))
    let restoreFailure
    try {
      retryBinding()
    } catch (error) {
      restoreFailure = error
    }
    assert.match(errorMessages(restoreFailure), /detecting restore fault/)
    assert.equal(detectingEnabled, false)
    assert.equal(topDocument.listenerCount('mousemove'), 0)
    retryBinding()
    assert.equal(detectingEnabled, true)
    retryFixture.marquee.dispose()
    retryFixture.disposeRuntime()
  })
})

const createWriteCountingSchema = () => {
  let xWrites = 0
  let yWrites = 0
  const rect = {}
  Object.defineProperties(rect, {
    x: { configurable: true, set: () => (xWrites += 1) },
    y: { configurable: true, set: () => (yWrites += 1) },
  })
  return {
    counts: () => ({ x: xWrites, y: yWrites }),
    schema: { $dashboard: { rect } },
  }
}

test('real engine restart crosses capability disposal and rebuilds dashboard runtime once', async t => {
  await withFakeWindow(async topDocument => {
    const engine = createEngine({ hostWindow: null, trustPolicy: 'legacyTrusted' })
    t.after(() => engine.destroy())
    await engine.plugins.register(
      DashboardPlugin({
        group: {
          initSchema: { componentName: 'Group', isGroup: true },
          meta: { componentName: 'Group' },
        },
      }),
    )

    await engine.init()
    const firstGuideline = engine.designer.guideline
    const firstMarquee = engine.designer.marqueeSelection
    const shell = new FakeEventTarget()
    const disposeBinding = firstMarquee.from(
      shell,
      { toLocalPoint: event => ({ clientX: event.clientX, clientY: event.clientY }) },
      () => false,
    )
    shell.emit('mousedown', createMouseEvent({ view: { document: topDocument } }))
    assert.equal(firstMarquee.isSelecting(), true)
    assert.equal(topDocument.listenerCount('mousemove'), 1)

    engine.designer.postEvent(VIEWPORT_MOUNT, { viewport: { height: 300, width: 400 } })
    assert.equal(firstGuideline.guideLines.length, 6)

    const firstInsert = createWriteCountingSchema()
    engine.designer.postEvent(INSERT_NODE_BEFORE, {
      event: { canvasX: 40, canvasY: 60, dragObject: { data: firstInsert.schema, type: 'nodedata' } },
    })
    assert.deepEqual(firstInsert.counts(), { x: 1, y: 1 })

    try {
      await engine.destroy()
    } catch (error) {
      assert.fail(errorMessages(error))
    }
    assert.equal(firstGuideline.guideLines.length, 0)
    assert.equal(firstMarquee.isSelecting(), false)
    assert.equal(shell.listenerCount('mousedown'), 0)
    assert.equal(topDocument.listenerCount('mousemove'), 0)
    disposeBinding()
    assert.throws(() => engine.designer.guideline, /runtime is not active/)
    assert.throws(() => engine.designer.alignment, /runtime is not active/)
    assert.throws(() => engine.designer.marqueeSelection, /runtime is not active/)
    await engine.init()

    const restartedGuideline = engine.designer.guideline
    const restartedMarquee = engine.designer.marqueeSelection
    assert.notEqual(restartedGuideline, firstGuideline)
    assert.notEqual(restartedMarquee, firstMarquee)
    engine.designer.postEvent(VIEWPORT_MOUNT, { viewport: { height: 500, width: 600 } })
    assert.equal(restartedGuideline.guideLines.length, 6)
    assert.equal(firstGuideline.guideLines.length, 0)

    const restartedInsert = createWriteCountingSchema()
    engine.designer.postEvent(INSERT_NODE_BEFORE, {
      event: { canvasX: 80, canvasY: 100, dragObject: { data: restartedInsert.schema, type: 'nodedata' } },
    })
    assert.deepEqual(restartedInsert.counts(), { x: 1, y: 1 }, 'restart must not duplicate the plugin listener')
    await engine.destroy()
  })
})

test('deleting an active dashboard plugin restores detecting and removes marquee listeners', async t => {
  await withFakeWindow(async topDocument => {
    const engine = createEngine({ hostWindow: null, trustPolicy: 'legacyTrusted' })
    t.after(() => engine.destroy())
    await engine.plugins.register(
      DashboardPlugin({
        group: {
          initSchema: { componentName: 'Group', isGroup: true },
          meta: { componentName: 'Group' },
        },
      }),
    )
    await engine.init()

    const marquee = engine.designer.marqueeSelection
    const shell = new FakeEventTarget()
    const disposeBinding = marquee.from(
      shell,
      { toLocalPoint: event => ({ clientX: event.clientX, clientY: event.clientY }) },
      () => false,
    )
    shell.emit('mousedown', createMouseEvent({ view: { document: topDocument } }))
    assert.equal(engine.designer.detecting.enable, false)
    assert.equal(topDocument.listenerCount('mousemove'), 1)

    assert.equal(await engine.plugins.delete('DashboardPlugin'), true)
    assert.equal(engine.designer.detecting.enable, true)
    assert.equal(marquee.isSelecting(), false)
    assert.equal(shell.listenerCount('mousedown'), 0)
    assert.equal(topDocument.listenerCount('mousemove'), 0)
    assert.equal(topDocument.listenerCount('mouseup'), 0)
    assert.equal(engine.plugins.has('DashboardPlugin'), false)
    assert.throws(() => engine.designer.guideline, /runtime is not active/)
    assert.throws(() => engine.designer.alignment, /runtime is not active/)
    assert.throws(() => engine.designer.marqueeSelection, /runtime is not active/)
    disposeBinding()
    await engine.destroy()
  })
})

test('process-level dashboard getters cannot be borrowed by an unregistered legacy-trusted engine', async t => {
  const owner = createEngine({ hostWindow: null, trustPolicy: 'legacyTrusted' })
  const unregistered = createEngine({ hostWindow: null, trustPolicy: 'legacyTrusted' })
  t.after(() => Promise.allSettled([owner.destroy(), unregistered.destroy()]))
  await owner.plugins.register(
    DashboardPlugin({
      group: {
        initSchema: { componentName: 'Group', isGroup: true },
        meta: { componentName: 'Group' },
      },
    }),
  )

  await owner.init()
  await unregistered.init()
  assert.ok(owner.designer.guideline)
  assert.throws(() => unregistered.designer.guideline, /runtime is not active/)
  assert.throws(() => unregistered.designer.alignment, /runtime is not active/)
  assert.throws(() => unregistered.designer.marqueeSelection, /runtime is not active/)

  const lifecycleSymbol = Object.getOwnPropertySymbols(Object.getPrototypeOf(unregistered.designer)).find(
    symbol => symbol.description === '@easy-editor/plugin-dashboard/runtime-lifecycle',
  )
  assert.ok(
    lifecycleSymbol,
    'the process-level extension is reflectable, so activation must also require a private token',
  )
  assert.throws(
    () => unregistered.designer[lifecycleSymbol](),
    /private lease token/,
    'discovering the prototype symbol must not grant runtime ownership',
  )
  assert.throws(() => unregistered.designer.guideline, /runtime is not active/)
  assert.throws(() => unregistered.designer.marqueeSelection, /runtime is not active/)

  const manuallyInvokedPlugin = DashboardPlugin({
    group: {
      initSchema: { componentName: 'Group', isGroup: true },
      meta: { componentName: 'Group' },
    },
  })
  assert.throws(
    () =>
      manuallyInvokedPlugin.init({
        materials: { createComponentMeta: () => assert.fail('manual activation must fail before mutation') },
        project: { designer: unregistered.designer },
        onDispose: () => assert.fail('manual activation must not obtain a runtime disposer'),
      }),
    /registered DashboardPlugin/,
    'calling the public plugin config directly must not lend its private token to an unregistered engine',
  )

  await owner.plugins.delete('DashboardPlugin')
  assert.throws(() => owner.designer.guideline, /runtime is not active/)
  await owner.destroy()
  await unregistered.destroy()
})

test('dashboard context cleanup restores active marquee state during init rollback', async t => {
  await withFakeWindow(async topDocument => {
    const engine = createEngine({ hostWindow: null, trustPolicy: 'legacyTrusted' })
    t.after(() => engine.destroy())
    const shell = new FakeEventTarget()
    let activeMarquee
    await engine.plugins.register(
      DashboardPlugin({
        group: {
          initSchema: { componentName: 'Group', isGroup: true },
          meta: { componentName: 'Group' },
        },
      }),
    )
    await engine.plugins.register({
      name: 'FailAfterMarquee',
      deps: ['DashboardPlugin'],
      init(ctx) {
        activeMarquee = ctx.project.designer.marqueeSelection
        activeMarquee.from(
          shell,
          { toLocalPoint: event => ({ clientX: event.clientX, clientY: event.clientY }) },
          () => false,
        )
        shell.emit('mousedown', createMouseEvent({ view: { document: topDocument } }))
        throw new Error('rollback plugin failure')
      },
    })

    await assert.rejects(engine.init(), /rollback plugin failure/)
    assert.equal(engine.lifecycleState, 'created')
    assert.equal(engine.designer.detecting.enable, true)
    assert.ok(activeMarquee, 'the failing plugin must have activated the dashboard marquee helper')
    assert.equal(shell.listenerCount('mousedown'), 0)
    assert.equal(topDocument.listenerCount('mousemove'), 0)
    assert.equal(topDocument.listenerCount('mouseup'), 0)
    assert.throws(() => engine.designer.guideline, /runtime is not active/)
    assert.throws(() => engine.designer.alignment, /runtime is not active/)
    assert.throws(() => engine.designer.marqueeSelection, /runtime is not active/)
    await engine.destroy()
  })
})
