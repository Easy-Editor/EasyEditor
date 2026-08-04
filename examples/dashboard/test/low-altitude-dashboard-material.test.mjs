import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import ts from 'typescript'
import { compileSafeMaterialManifest } from '../src/editor/agent/manifest/index.mjs'

const dashboardRoot = new URL('../src/editor/materials/', import.meta.url)

const read = path => readFile(new URL(path, dashboardRoot), 'utf8')

const transpileTsModule = async path => {
  const source = await read(path)
  return {
    output: ts.transpileModule(source, {
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: path,
    }).outputText,
    source,
  }
}

const importTranspiledTsModule = async path => {
  const { output } = await transpileTsModule(path)
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`)
}

test('LowAltitudeDashboard is registered as a built-in material and renderer', async () => {
  const [metaRegistry, componentRegistry] = await Promise.all([read('meta.ts'), read('component.ts')])
  assert.match(metaRegistry, /low-altitude-dashboard\/meta/u)
  assert.match(metaRegistry, /LowAltitudeDashboard,/u)
  assert.match(componentRegistry, /low-altitude-dashboard\/component/u)
  assert.match(componentRegistry, /LowAltitudeDashboard,/u)
})

test('LowAltitudeDashboard configure compiles a ready writable manifest', async () => {
  const configureSource = await read('inner/low-altitude-dashboard/configure.ts')
  const metadata = {
    componentName: 'LowAltitudeDashboard',
    title: '低空经济运行态势大屏',
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
                {
                  name: 'title',
                  title: '标题',
                  setter: 'StringSetter',
                  extraProps: {
                    getValue() {},
                    setValue() {},
                  },
                },
                {
                  type: 'group',
                  title: '基础属性',
                  setter: { componentName: 'CollapseSetter', props: { icon: false } },
                  items: [
                    {
                      name: 'rect',
                      title: '位置尺寸',
                      setter: 'RectSetter',
                      extraProps: {
                        getValue() {},
                        setValue() {},
                      },
                    },
                  ],
                },
                { name: 'heading', title: '画面标题', setter: 'StringSetter' },
                { name: 'data', title: '低空运营数据', setter: 'JsonSetter' },
              ],
            },
          ],
        },
      ],
      advanced: { view() {} },
    },
  }

  const manifest = compileSafeMaterialManifest({
    materialRegistryVersion: 1,
    metadata,
  })
  const fields = new Map(manifest.fields.map(field => [field.fieldId, field]))

  assert.match(configureSource, /name:\s*'heading'[\s\S]*StringSetter/u)
  assert.match(configureSource, /name:\s*'data'[\s\S]*JsonSetter/u)
  assert.equal(manifest.readiness.status, 'ready')
  assert.equal(fields.get('props.data')?.access, 'read-write')
  assert.equal(fields.get('props.heading')?.access, 'read-write')
  assert.equal(fields.get('shared.rect')?.access, 'read-write')
  assert.equal(fields.get('shared.title')?.access, 'read-write')
})

test('LowAltitudeDashboard ships complete low-altitude defaults without external assets', async () => {
  const [data, componentModule, styles] = await Promise.all([
    read('inner/low-altitude-dashboard/data.ts'),
    transpileTsModule('inner/low-altitude-dashboard/component.tsx'),
    read('inner/low-altitude-dashboard/component.css'),
  ])
  const { output: component, source: componentSource } = componentModule

  for (const term of [
    '今日飞行',
    '在线飞行器',
    '开放航线',
    '告警事件',
    '桂花机场',
    '濛阳物流枢纽',
    '丹景山巡检区',
    '湔江文旅航线',
    'flightTrend',
    'taskMix',
    'alerts',
    'routes',
    'fleet',
    'tasks',
  ]) {
    assert.match(data, new RegExp(term, 'u'))
  }
  assert.match(componentSource, /低空飞行态势/u)
  assert.match(componentSource, /任务类型任务量/u)
  assert.match(componentSource, /item\.unit \?\? '项'/u)
  assert.match(componentSource, /近 7 日飞行架次/u)
  assert.match(data, /unit:\s*'项'/u)
  assert.match(styles, /#030c1a/u)
  assert.doesNotMatch(`${data}\n${component}\n${styles}`, /https?:\/\//u)
})

test('LowAltitudeDashboard normalizes malformed Agent data field by field', async () => {
  const { defaultLowAltitudeDashboardData, resolveLowAltitudeDashboardData } = await importTranspiledTsModule(
    'inner/low-altitude-dashboard/data.ts',
  )

  const resolved = resolveLowAltitudeDashboardData({
    kpis: [{ label: '自定义飞行量', value: Number.POSITIVE_INFINITY, unit: '架次', trend: null, tone: 'purple' }, null],
    flightTrend: [{ label: '今日', value: Number.NaN }],
    taskMix: [
      { label: '巡检', value: 12, unit: '项' },
      { label: null, value: 9, unit: {} },
    ],
    alerts: null,
    routes: 'not-an-array',
    fleet: [{ label: '执行中', value: 20, tone: 'green' }, 42],
    tasks: [{ id: 'CUSTOM-1', type: '巡检', route: 'A → B', status: '执行中' }, undefined],
  })

  assert.deepEqual(resolved.kpis[0], {
    label: '自定义飞行量',
    value: defaultLowAltitudeDashboardData.kpis[0].value,
    unit: '架次',
    trend: defaultLowAltitudeDashboardData.kpis[0].trend,
    tone: defaultLowAltitudeDashboardData.kpis[0].tone,
  })
  assert.deepEqual(resolved.kpis[1], defaultLowAltitudeDashboardData.kpis[1])
  assert.deepEqual(resolved.flightTrend[0], {
    label: '今日',
    value: defaultLowAltitudeDashboardData.flightTrend[0].value,
    unit: defaultLowAltitudeDashboardData.flightTrend[0].unit,
  })
  assert.deepEqual(resolved.taskMix[0], { label: '巡检', value: 12, unit: '项' })
  assert.deepEqual(resolved.taskMix[1], {
    label: defaultLowAltitudeDashboardData.taskMix[1].label,
    value: 9,
    unit: defaultLowAltitudeDashboardData.taskMix[1].unit,
  })
  assert.deepEqual(resolved.alerts, defaultLowAltitudeDashboardData.alerts)
  assert.deepEqual(resolved.routes, defaultLowAltitudeDashboardData.routes)
  assert.deepEqual(resolved.fleet[0], { label: '执行中', value: 20, tone: 'green' })
  assert.deepEqual(resolved.fleet[1], defaultLowAltitudeDashboardData.fleet[1])
  assert.deepEqual(resolved.tasks[0], {
    id: 'CUSTOM-1',
    type: '巡检',
    route: 'A → B',
    status: '执行中',
  })
  assert.deepEqual(resolved.tasks[1], defaultLowAltitudeDashboardData.tasks[1])
})

test('LowAltitudeDashboard bounds oversized Agent arrays while preserving valid entries', async () => {
  const { resolveLowAltitudeDashboardData } = await importTranspiledTsModule('inner/low-altitude-dashboard/data.ts')
  const resolved = resolveLowAltitudeDashboardData({
    kpis: Array.from({ length: 100 }, (_, index) => ({ label: `指标 ${index}`, value: index })),
    flightTrend: Array.from({ length: 100 }, (_, index) => ({ label: `日期 ${index}`, value: index })),
    taskMix: Array.from({ length: 100 }, (_, index) => ({ label: `任务 ${index}`, value: index, unit: '项' })),
    alerts: Array.from({ length: 100 }, (_, index) => ({ time: `${index}`, level: '提示', text: `告警 ${index}` })),
    routes: Array.from({ length: 100 }, (_, index) => ({ from: `A${index}`, to: `B${index}`, status: '通畅' })),
    fleet: Array.from({ length: 100 }, (_, index) => ({ label: `状态 ${index}`, value: index })),
    tasks: Array.from({ length: 100 }, (_, index) => ({
      id: `TASK-${index}`,
      type: '巡检',
      route: 'A → B',
      status: '执行中',
    })),
  })

  assert.equal(resolved.kpis.length, 4)
  assert.equal(resolved.flightTrend.length, 7)
  assert.equal(resolved.taskMix.length, 4)
  assert.equal(resolved.alerts.length, 3)
  assert.equal(resolved.routes.length, 6)
  assert.equal(resolved.fleet.length, 4)
  assert.equal(resolved.tasks.length, 4)
  assert.deepEqual(resolved.taskMix[3], { label: '任务 3', value: 3, unit: '项' })
  assert.deepEqual(resolved.routes[5], { from: 'A5', to: 'B5', status: '通畅' })
})
