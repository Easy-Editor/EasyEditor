import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import ts from 'typescript'
import { compileSafeMaterialManifest } from '../src/editor/agent/manifest/index.mjs'

const dashboardRoot = new URL('../src/editor/materials/', import.meta.url)
const read = path => readFile(new URL(path, dashboardRoot), 'utf8')

const importSpec = async () => {
  const source = await read('inner/dashboard-scene/spec.ts')
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: 'spec.ts',
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`)
}

test('DashboardScene is registered as a built-in material and renderer', async () => {
  const [metaRegistry, componentRegistry, executorRegistry] = await Promise.all([
    read('meta.ts'),
    read('component.ts'),
    readFile(new URL('../../../spikes/document-executor/harness/executor-materials.ts', import.meta.url), 'utf8'),
  ])
  assert.match(metaRegistry, /dashboard-scene\/meta/u)
  assert.match(metaRegistry, /DashboardScene,/u)
  assert.match(componentRegistry, /dashboard-scene\/component/u)
  assert.match(componentRegistry, /DashboardScene,/u)
  assert.match(executorRegistry, /\{ component: DashboardScene, meta: DashboardSceneMeta \}/u)
})

test('DashboardScene configure compiles props.spec and shared fields as writable', async () => {
  const configureSource = await read('inner/dashboard-scene/configure.ts')
  const metadata = {
    componentName: 'DashboardScene',
    title: '通用可视化大屏场景',
    group: 'Inner',
    configure: {
      props: [
        {
          type: 'group',
          title: '功能',
          setter: 'TabSetter',
          items: [
            {
              type: 'group',
              key: 'basic',
              title: '基本',
              items: [
                { name: 'title', title: '标题', setter: 'StringSetter', extraProps: { getValue() {}, setValue() {} } },
                {
                  type: 'group',
                  title: '基础属性',
                  setter: { componentName: 'CollapseSetter', props: { icon: false } },
                  items: [
                    {
                      name: 'rect',
                      title: '位置尺寸',
                      setter: 'RectSetter',
                      extraProps: { getValue() {}, setValue() {} },
                    },
                  ],
                },
                { name: 'spec', title: '大屏场景规范', setter: 'JsonSetter' },
                { name: 'widgetData', title: '主物料数据覆盖', setter: 'JsonSetter' },
              ],
            },
          ],
        },
      ],
      advanced: { view() {} },
    },
  }

  const manifest = compileSafeMaterialManifest({ materialRegistryVersion: 1, metadata })
  const fields = new Map(manifest.fields.map(field => [field.fieldId, field]))

  assert.match(configureSource, /name:\s*'spec'[\s\S]*JsonSetter/u)
  assert.match(configureSource, /name:\s*'widgetData'[\s\S]*JsonSetter/u)
  assert.equal(manifest.readiness.status, 'ready')
  assert.equal(fields.get('props.spec')?.access, 'read-write')
  assert.equal(fields.get('props.widgetData')?.access, 'read-write')
  assert.equal(fields.get('shared.rect')?.access, 'read-write')
  assert.equal(fields.get('shared.title')?.access, 'read-write')
})

test('DashboardScene primary widget data override preserves the base scene contract', async () => {
  const { applyDashboardScenePrimaryWidgetData, normalizeDashboardSceneSpec } = await importSpec()
  const scene = normalizeDashboardSceneSpec({
    canvas: { width: 960, height: 540 },
    theme: { accent: '#d7192d' },
    widgets: [
      {
        id: 'primary',
        kind: 'combo-map',
        rect: { x: 10, y: 20, width: 600, height: 400 },
        data: { chart: [{ label: '基础', profit: 1 }], activeTab: '业绩表现' },
      },
      { id: 'secondary', kind: 'table', data: { rows: [['保留']] } },
    ],
  })
  const result = applyDashboardScenePrimaryWidgetData(scene, {
    ...JSON.parse('{"__proto__":{"polluted":true}}'),
    activeTab: '偿债能力',
    tabViews: { solvency: { chart: [{ label: '一月', profit: 20 }] } },
    oversized: 'x'.repeat(900),
  })

  assert.equal(result.canvas, scene.canvas)
  assert.equal(result.theme, scene.theme)
  assert.equal(result.widgets[0].rect, scene.widgets[0].rect)
  assert.equal(result.widgets[1], scene.widgets[1])
  assert.deepEqual(result.widgets[0].data, {
    chart: [{ label: '基础', profit: 1 }],
    activeTab: '偿债能力',
    tabViews: { solvency: { chart: [{ label: '一月', profit: 20 }] } },
    oversized: 'x'.repeat(512),
  })
  assert.equal(Object.prototype.polluted, undefined)
})

test('default bank scene covers the complete financial dashboard widget set', async () => {
  const { defaultBankFinancialSceneSpec } = await importSpec()
  const kinds = defaultBankFinancialSceneSpec.widgets.map(widget => widget.kind)

  assert.equal(defaultBankFinancialSceneSpec.version, 1)
  assert.deepEqual(defaultBankFinancialSceneSpec.canvas, { width: 1920, height: 1080 })
  assert.equal(kinds.filter(kind => kind === 'kpi').length, 3)
  for (const kind of ['combo-map', 'table', 'rank', 'line', 'donut', 'cluster']) {
    assert.ok(kinds.includes(kind), `missing ${kind} widget`)
  }
  assert.ok(
    defaultBankFinancialSceneSpec.widgets.some(widget => widget.kind === 'table' && widget.data.scroll === true),
  )
  assert.ok(defaultBankFinancialSceneSpec.widgets.every(widget => widget.rect.y + widget.rect.height <= 1004))
  assert.equal(defaultBankFinancialSceneSpec.widgets.find(widget => widget.id === 'shareholders').data.items.length, 8)
  assert.equal(
    defaultBankFinancialSceneSpec.widgets.find(widget => widget.id === 'competitiveness').data.items.length,
    7,
  )
  assert.ok(
    defaultBankFinancialSceneSpec.widgets
      .find(widget => widget.id === 'products')
      .data.rows.every(row => Number.isInteger(row.at(-1)) && row.at(-1) >= 1 && row.at(-1) <= 5),
  )
  assert.match(defaultBankFinancialSceneSpec.header.title, /银行/u)
})

test('DashboardScene runtime default is one localized headerless auto-scrolling table', async () => {
  const { defaultLocalizedDashboardSceneSpec } = await importSpec()

  assert.deepEqual(defaultLocalizedDashboardSceneSpec.canvas, { width: 480, height: 280 })
  assert.equal(defaultLocalizedDashboardSceneSpec.header.showHeader, false)
  assert.equal(defaultLocalizedDashboardSceneSpec.header.showClock, false)
  assert.equal(defaultLocalizedDashboardSceneSpec.widgets.length, 1)
  assert.equal(defaultLocalizedDashboardSceneSpec.widgets[0].kind, 'table')
  assert.deepEqual(defaultLocalizedDashboardSceneSpec.widgets[0].rect, { x: 0, y: 0, width: 480, height: 280 })
  assert.equal(defaultLocalizedDashboardSceneSpec.widgets[0].data.autoScroll, true)
})

test('DashboardScene source keeps live clock and native chart/list animations', async () => {
  const [component, styles, mapSource] = await Promise.all([
    read('inner/dashboard-scene/component.tsx'),
    read('inner/dashboard-scene/component.css'),
    read('inner/dashboard-scene/china-provinces.geo.json'),
  ])
  const map = JSON.parse(mapSource)

  assert.match(component, /setInterval\([\s\S]{0,100}1000\)/u)
  assert.match(component, /isAnimationActive/u)
  assert.match(component, /normalizeDashboardSceneSpec/u)
  assert.match(component, /china-provinces\.geo\.json\?raw/u)
  assert.match(component, /GeoJSON 区域地图/u)
  assert.equal(map.type, 'FeatureCollection')
  assert.equal(map.features.length, 34)
  assert.match(styles, /@keyframes ds-scroll/u)
  assert.match(styles, /animation:\s*ds-scroll/u)
  assert.match(component, /dashboard-scene-rating/u)
  assert.match(component, /is-top-rank-/u)
  assert.match(
    styles,
    /dashboard-scene-cluster-layer[\s\S]*border-radius:\s*23%[\s\S]*rotate\(var\(--ds-cluster-layer-rotation\)\)/u,
  )
  assert.match(styles, /border-radius:\s*32px/u)
  assert.doesNotMatch(`${component}\n${styles}`, /https?:\/\//u)
})

test('DashboardScene supports localized map controls, dual rings, centered clusters, and dense tables', async () => {
  const [component, styles] = await Promise.all([
    read('inner/dashboard-scene/component.tsx'),
    read('inner/dashboard-scene/component.css'),
  ])
  const { normalizeDashboardSceneSpec } = await importSpec()
  const normalized = normalizeDashboardSceneSpec({
    widgets: [
      {
        id: 'map',
        kind: 'combo-map',
        data: {
          highlights: [{ name: '四川省', label: '四川', color: '#d7192d', emphasis: true }],
          tabs: ['本月'],
          activeTab: '本月',
          legend: [{ label: '重点区域', fill: '#d7192d' }],
          provinceTabs: ['四川省'],
          selectedProvince: '四川省',
        },
      },
      {
        id: 'donut',
        kind: 'donut',
        data: { rings: [{ items: [['外环', 60]] }, { items: [['内环', 40]] }], legendItems: [['合计', 100]] },
      },
      { id: 'cluster', kind: 'cluster', data: { items: ['A', 'B', 'C'], centerItem: 'B' } },
      { id: 'table', kind: 'table', data: { rowHeight: 36, headerHeight: 34 } },
    ],
  })

  assert.equal(normalized.widgets[0].data.activeTab, '本月')
  assert.equal(normalized.widgets[0].data.selectedProvince, '四川省')
  assert.equal(normalized.widgets[1].data.rings.length, 2)
  assert.equal(normalized.widgets[2].data.centerItem, 'B')
  assert.equal(normalized.widgets[3].data.rowHeight, 36)
  assert.equal(normalized.widgets[3].data.headerHeight, 34)
  assert.match(component, /style=\{region\?\.fill \? \{ fill: region\.fill \} : undefined\}/u)
  assert.match(component, /array\(data\.rings\)[\s\S]*slice\(0, 2\)/u)
  assert.match(component, /legendItems/u)
  assert.match(component, /const sourceItems = array\(data\.items\)[\s\S]*slice\(0, 7\)[\s\S]*const centerItem/u)
  assert.match(component, /configuredLayers[\s\S]*dashboard-scene-cluster-layer/u)
  assert.match(component, /<title>\{region\?\.label \|\| feature\.name\}<\/title>/u)
  assert.match(styles, /--ds-row-height[\s\S]*--ds-header-height/u)
  assert.match(styles, /dashboard-scene-combo-tabs/u)
  assert.match(styles, /dashboard-scene-province-tabs/u)
})

test('DashboardScene normalization bounds malicious and oversized Agent input', async () => {
  const { DASHBOARD_SCENE_MAX_WIDGETS, normalizeDashboardSceneSpec } = await importSpec()
  const malicious = JSON.parse('{"__proto__":{"polluted":true},"constructor":{"x":1}}')
  const normalized = normalizeDashboardSceneSpec({
    ...malicious,
    version: 999,
    canvas: { width: 999999, height: -1 },
    header: { title: 'x'.repeat(1000), subtitle: 42, brand: 'b'.repeat(200), showClock: 'yes' },
    theme: { background: 'url(javascript:alert(1))', text: '#123456' },
    widgets: Array.from({ length: 100 }, (_, index) => ({
      id: `widget-${index}-${'x'.repeat(100)}`,
      kind: index === 0 ? 'not-real' : 'table',
      title: 't'.repeat(1000),
      rect: { x: -999, y: Number.POSITIVE_INFINITY, width: 999999, height: Number.NaN },
      data: { rows: Array.from({ length: 200 }, () => Array.from({ length: 100 }, () => 'v'.repeat(1000))) },
    })),
    map: {
      type: 'FeatureCollection',
      features: Array.from({ length: 200 }, () => ({
        type: 'Feature',
        properties: { name: 'n' },
        geometry: { type: 'Polygon', coordinates: [] },
      })),
    },
  })

  assert.equal(normalized.version, 1)
  assert.deepEqual(normalized.canvas, { width: 480, height: 280 })
  assert.ok(normalized.widgets.length <= DASHBOARD_SCENE_MAX_WIDGETS)
  assert.equal(normalized.header.title.length, 120)
  assert.equal(normalized.header.brand.length, 80)
  assert.equal(normalized.header.showClock, true)
  assert.equal(normalized.theme.background, '#eef3f7')
  assert.equal(normalized.theme.text, '#123456')
  assert.equal(normalized.map, undefined)
  assert.equal(Object.prototype.polluted, undefined)
  for (const widget of normalized.widgets) {
    assert.ok(widget.id.length <= 80)
    assert.ok(widget.title.length <= 120)
    assert.ok(widget.rect.x >= 0 && widget.rect.y >= 0)
    assert.ok(widget.rect.width <= 480 && widget.rect.height <= 280)
  }
})

test('DashboardScene normalization accepts model-friendly flattened widget fields', async () => {
  const { normalizeDashboardSceneSpec } = await importSpec()
  const normalized = normalizeDashboardSceneSpec({
    widgets: [
      {
        id: 'flat-kpi',
        kind: 'kpi',
        title: '净利润',
        rect: { x: 0, y: 0, width: 400, height: 180 },
        value: 1023.43,
        unit: '亿元',
        trend: [1, 2, 3],
      },
    ],
  })

  assert.deepEqual(normalized.widgets[0].data, { trend: [1, 2, 3], unit: '亿元', value: 1023.43 })
})

test('DashboardScene normalization accepts a localized canvas and optional header', async () => {
  const { normalizeDashboardSceneSpec } = await importSpec()
  const normalized = normalizeDashboardSceneSpec({
    canvas: { width: 640, height: 360 },
    header: { showHeader: false, showClock: false },
    widgets: [
      {
        id: 'localized-kpi',
        kind: 'kpi',
        title: '局部指标',
        rect: { x: 600, y: 320, width: 200, height: 100 },
      },
    ],
  })

  assert.deepEqual(normalized.canvas, { width: 640, height: 360 })
  assert.equal(normalized.header.showHeader, false)
  assert.equal(normalized.header.showClock, false)
  assert.deepEqual(normalized.widgets[0].rect, { x: 600, y: 320, width: 40, height: 40 })
})
