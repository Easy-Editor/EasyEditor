import assert from 'node:assert/strict'
import test from 'node:test'

import {
  LOW_ALTITUDE_DASHBOARD_EVAL_SCENARIOS,
  evaluateLowAltitudeDashboard,
} from '../src/agent-runtime/evals/low-altitude-dashboard.mjs'

const rect = (x, y, width, height) => ({ x, y, width, height })

const chart = (id, componentName, title, x, seriesKey) => ({
  id,
  componentName,
  title,
  props: {
    data: [
      { period: '08:00', [seriesKey]: 28 },
      { period: '10:00', [seriesKey]: 42 },
    ],
    xKey: 'period',
    series: [{ dataKey: seriesKey, name: title }],
  },
  $dashboard: { rect: rect(x, 420, 580, 300) },
  children: [],
})

const passingDocument = () => ({
  id: 'root',
  componentName: 'Root',
  title: '彭州低空经济运营态势',
  props: { backgroundColor: '#07162b' },
  $dashboard: { rect: rect(0, 0, 1920, 1080) },
  children: [
    {
      id: 'title',
      componentName: 'Text',
      props: { text: '彭州低空经济运营态势大屏' },
      $dashboard: { rect: rect(560, 24, 800, 64) },
      children: [],
    },
    ...[
      ['kpi-flights', '今日飞行架次 286', 80],
      ['kpi-aircraft', '在飞航空器 37', 400],
      ['kpi-alerts', '告警事件 5', 720],
      ['kpi-vertiports', '起降点在线率 98.6%', 1040],
    ].map(([id, text, x]) => ({
      id,
      componentName: 'Text',
      props: { text },
      $dashboard: { rect: rect(x, 130, 260, 96) },
      children: [],
    })),
    chart('flight-trend', 'LineChart', '飞行架次趋势', 80, 'flightCount'),
    chart('airspace-usage', 'BarChart', '空域使用率', 720, 'usageRate'),
    {
      id: 'alerts',
      componentName: 'Text',
      props: { text: '实时飞行告警：无人机偏离航线' },
      $dashboard: { rect: rect(1360, 420, 420, 300) },
      children: [],
    },
  ],
})

const appliedReceipt = {
  capability: 'screen.applyChangeSet',
  receipt: {
    schemaVersion: 1,
    callId: 'screen-write-1',
    status: 'applied',
    revision: 'dashboard-revision-2',
  },
}

const onlineReceipt = capability => ({
  capability,
  receipt: {
    schemaVersion: 1,
    callId: `${capability}-1`,
    status: 'applied',
    revision: 'dashboard-revision-2',
  },
})

const lowAltitudeDashboardDocument = ({ flightValue = 286 } = {}) => ({
  id: 'root',
  componentName: 'Root',
  $dashboard: { rect: rect(0, 0, 1920, 1080) },
  children: [
    {
      id: 'low-altitude-dashboard',
      componentName: 'LowAltitudeDashboard',
      props: {
        heading: '彭州低空经济运营态势',
        data: {
          kpis: [
            { label: '今日飞行', value: flightValue, unit: '架次' },
            { label: '在线飞行器', value: 42, unit: '架' },
            { label: '执行中任务', value: 18, unit: '个' },
            { label: '告警事件', value: 5, unit: '起' },
          ],
          flightTrend: [
            { label: '07/27', value: 272 },
            { label: '今日', value: flightValue },
          ],
          taskMix: [
            { label: '巡检', value: 36, unit: '项' },
            { label: '物流', value: 28, unit: '项' },
          ],
          alerts: [{ time: '10:42:18', level: '紧急', text: '湔江航段突发阵风' }],
          routes: [{ from: '桂花机场', to: '濛阳物流枢纽', status: '通畅' }],
          fleet: [{ label: '执行中', value: 18 }],
          tasks: [{ id: 'PZ-0728-042', type: '电力巡检', route: '桂花机场 → 丹景山', status: '执行中' }],
        },
      },
      $dashboard: { rect: rect(0, 0, 1920, 1080) },
      children: [],
    },
  ],
})

const onlineDocument = () => ({
  id: 'root',
  componentName: 'Root',
  $dashboard: { rect: rect(0, 0, 1920, 1080) },
  children: [
    {
      id: 'low-altitude-online-dashboard',
      componentName: 'GeneratedMaterialHost',
      $dashboard: { rect: rect(0, 0, 1920, 1080) },
      children: [],
    },
  ],
})

test('exports the low-altitude evaluation scenarios including the generation and regression gates', () => {
  assert.ok(LOW_ALTITUDE_DASHBOARD_EVAL_SCENARIOS.length >= 5)
  assert.ok(LOW_ALTITUDE_DASHBOARD_EVAL_SCENARIOS.some(scenario => scenario.id === 'EVAL-LA-01'))
  assert.ok(LOW_ALTITUDE_DASHBOARD_EVAL_SCENARIOS.some(scenario => scenario.id === 'EVAL-LA-03'))
  assert.ok(LOW_ALTITUDE_DASHBOARD_EVAL_SCENARIOS.some(scenario => scenario.id === 'EVAL-LA-04'))
  assert.ok(LOW_ALTITUDE_DASHBOARD_EVAL_SCENARIOS.some(scenario => scenario.id === 'EVAL-LA-05'))
})

test('passes a completed, mutated, data-ready low-altitude operations dashboard', () => {
  const result = evaluateLowAltitudeDashboard({
    scenarioId: 'EVAL-LA-01',
    dashboardDocument: passingDocument(),
    runtimeStatus: { status: 'COMPLETED' },
    toolCallReceipts: [appliedReceipt],
    consoleErrors: [],
  })

  assert.equal(result.hardGatePassed, true)
  assert.equal(result.score, 100)
  assert.deepEqual(result.failureTags, [])
  assert.equal(result.dimensionScores.chartDataQuality, 100)
  assert.ok(result.evidence.kpiCount >= 4)
  assert.equal(result.evidence.validBusinessChartCount, 2)
})

test('accepts the existing tool-call result wrapper when it contains a formal applied invocation DTO', () => {
  const result = evaluateLowAltitudeDashboard({
    dashboardDocument: passingDocument(),
    runtimeStatus: 'COMPLETED',
    toolCallReceipts: [
      {
        capability: 'screen.applyChangeSet',
        result: {
          schemaVersion: 1,
          callId: 'screen-write-result-1',
          status: 'applied',
          revision: 'dashboard-revision-2',
        },
      },
    ],
    consoleErrors: [],
  })

  assert.equal(result.hardGatePassed, true)
  assert.deepEqual(result.evidence.writeCapabilities, ['screen.applyChangeSet'])
})

test('passes a real single-node LowAltitudeDashboard whose data provides four business visual sections', () => {
  const result = evaluateLowAltitudeDashboard({
    scenarioId: 'EVAL-LA-01',
    dashboardDocument: lowAltitudeDashboardDocument(),
    runtimeStatus: { status: 'COMPLETED' },
    toolCallReceipts: [appliedReceipt],
    consoleErrors: [],
  })

  assert.equal(result.hardGatePassed, true)
  assert.equal(result.evidence.validBusinessChartCount, 0)
  assert.equal(result.evidence.validBuiltInBusinessSectionCount, 4)
  assert.equal(result.evidence.validBusinessVisualCount, 4)
})

test('fails a single-node LowAltitudeDashboard when fewer than two built-in business sections are usable', () => {
  const document = lowAltitudeDashboardDocument()
  document.children[0].props.data.flightTrend = []
  document.children[0].props.data.taskMix = []
  document.children[0].props.data.routes = []

  const result = evaluateLowAltitudeDashboard({
    scenarioId: 'EVAL-LA-01',
    dashboardDocument: document,
    runtimeStatus: 'COMPLETED',
    toolCallReceipts: [appliedReceipt],
    consoleErrors: [],
  })

  assert.equal(result.hardGatePassed, false)
  assert.ok(result.failureTags.includes('INSUFFICIENT_BUSINESS_CHARTS'))
  assert.equal(result.evidence.validBuiltInBusinessSectionCount, 1)
})

test('passes a full-canvas online artifact using rendered text and explicit visual evidence', () => {
  const result = evaluateLowAltitudeDashboard({
    scenarioId: 'EVAL-LA-01',
    dashboardDocument: onlineDocument(),
    renderedText:
      '彭州低空经济运营态势 今日飞行架次 286 在飞航空器 37 告警事件 5 起降点在线率 98.6% 飞行趋势 空域使用率 实时告警 航线监管',
    runtimeStatus: 'COMPLETED',
    toolCallReceipts: [onlineReceipt('artifact.createOnline')],
    onlineArtifactEvidence: {
      lifecycleReady: true,
      fullCanvas: true,
      visualSectionCount: 5,
    },
    consoleErrors: [],
  })

  assert.equal(result.hardGatePassed, true)
  assert.equal(result.score, 100)
  assert.deepEqual(result.failureTags, [])
  assert.equal(result.evidence.onlineArtifact, true)
  assert.equal(result.evidence.onlineVisualSectionCount, 5)
  assert.equal(result.evidence.validBusinessChartCount, 0)
})

test('accepts artifact.reviseOnline as an applied online write', () => {
  const result = evaluateLowAltitudeDashboard({
    dashboardDocument: onlineDocument(),
    renderedText: '低空运营态势 今日飞行架次 286 在飞无人机 37 告警事件 5 起降点在线率 98% 空域 航线',
    runtimeStatus: 'COMPLETED',
    toolCallReceipts: [onlineReceipt('artifact.reviseOnline')],
    onlineArtifactEvidence: {
      lifecycleReady: true,
      fullCanvas: true,
      visualSectionCount: 2,
    },
    consoleErrors: [],
  })

  assert.equal(result.hardGatePassed, true)
  assert.equal(result.evidence.writeApplied, true)
})

test('fails an online artifact without lifecycle, full-canvas, and two-section evidence', () => {
  const result = evaluateLowAltitudeDashboard({
    dashboardDocument: onlineDocument(),
    renderedText: '低空运营态势 今日飞行架次 286 在飞无人机 37 告警事件 5 起降点在线率 98% 空域 航线',
    runtimeStatus: 'COMPLETED',
    toolCallReceipts: [onlineReceipt('artifact.createOnline')],
    onlineArtifactEvidence: {
      lifecycleReady: false,
      fullCanvas: false,
      visualSectionCount: 1,
    },
    consoleErrors: [],
  })

  assert.equal(result.hardGatePassed, false)
  assert.ok(result.failureTags.includes('ONLINE_ARTIFACT_INVALID'))
  assert.equal(result.dimensionScores.businessCharts, 50)
  assert.equal(result.dimensionScores.chartDataQuality, 0)
  assert.equal(result.dimensionScores.layout, 0)
})

test('uses rendered text to reject default demo labels in online artifacts', () => {
  const result = evaluateLowAltitudeDashboard({
    dashboardDocument: onlineDocument(),
    renderedText: '低空运营态势 今日飞行架次 286 在飞无人机 37 告警事件 5 起降点在线率 98% Desktop Mobile',
    runtimeStatus: 'COMPLETED',
    toolCallReceipts: [onlineReceipt('artifact.createOnline')],
    onlineArtifactEvidence: {
      lifecycleReady: true,
      fullCanvas: true,
      visualSectionCount: 2,
    },
    consoleErrors: [],
  })

  assert.equal(result.hardGatePassed, false)
  assert.ok(result.failureTags.includes('DEFAULT_DEMO_DATA'))
})

test('fails an unchanged dashboard without a completed runtime or applied write', () => {
  const emptyDocument = {
    id: 'root',
    componentName: 'Root',
    $dashboard: { rect: rect(0, 0, 1920, 1080) },
    children: [],
  }
  const result = evaluateLowAltitudeDashboard({
    dashboardDocument: emptyDocument,
    initialDashboardDocument: structuredClone(emptyDocument),
    runtimeStatus: 'RUNNING',
    toolCallReceipts: [],
    consoleErrors: [],
  })

  assert.equal(result.hardGatePassed, false)
  assert.ok(result.failureTags.includes('INCOMPLETE_RUNTIME'))
  assert.ok(result.failureTags.includes('WRITE_NOT_APPLIED'))
  assert.ok(result.failureTags.includes('CANVAS_UNCHANGED'))
  assert.ok(result.failureTags.includes('LOW_ALTITUDE_SEMANTICS_MISSING'))
})

test('rejects recursively nested receipt-like strings that are not one formal tool-call receipt DTO', () => {
  const result = evaluateLowAltitudeDashboard({
    dashboardDocument: passingDocument(),
    runtimeStatus: 'COMPLETED',
    toolCallReceipts: [
      {
        metadata: {
          claimedCapability: 'screen.applyChangeSet',
          claimedStatus: 'applied',
          claimedCallId: 'forged-call',
          claimedRevision: 'forged-revision',
        },
      },
    ],
    consoleErrors: [],
  })

  assert.equal(result.hardGatePassed, false)
  assert.ok(result.failureTags.includes('WRITE_NOT_APPLIED'))
  assert.deepEqual(result.evidence.writeCapabilities, [])
})

test('rejects capability and terminal write evidence split across different receipt objects', () => {
  const result = evaluateLowAltitudeDashboard({
    dashboardDocument: passingDocument(),
    runtimeStatus: 'COMPLETED',
    toolCallReceipts: [
      { capability: 'screen.applyChangeSet' },
      {
        receipt: {
          schemaVersion: 1,
          callId: 'screen-write-1',
          status: 'applied',
          revision: 'dashboard-revision-2',
        },
      },
    ],
    consoleErrors: [],
  })

  assert.equal(result.hardGatePassed, false)
  assert.ok(result.failureTags.includes('WRITE_NOT_APPLIED'))
  assert.deepEqual(result.evidence.writeCapabilities, [])
})

test('rejects an applied screen receipt without a revision that links it to the persisted write', () => {
  const result = evaluateLowAltitudeDashboard({
    dashboardDocument: passingDocument(),
    runtimeStatus: 'COMPLETED',
    toolCallReceipts: [
      {
        capability: 'screen.applyChangeSet',
        receipt: { schemaVersion: 1, callId: 'screen-write-1', status: 'applied' },
      },
    ],
    consoleErrors: [],
  })

  assert.equal(result.hardGatePassed, false)
  assert.ok(result.failureTags.includes('WRITE_NOT_APPLIED'))
})

test('fails default demo chart data even when the runtime wrote and completed', () => {
  const document = passingDocument()
  document.children.find(node => node.id === 'flight-trend').props.data = [
    { period: 'Desktop', flightCount: 186 },
    { period: 'Mobile', flightCount: 80 },
  ]

  const result = evaluateLowAltitudeDashboard({
    dashboardDocument: document,
    runtimeStatus: 'COMPLETED',
    toolCallReceipts: [appliedReceipt],
    consoleErrors: [],
  })

  assert.equal(result.hardGatePassed, false)
  assert.ok(result.failureTags.includes('DEFAULT_DEMO_DATA'))
  assert.equal(result.dimensionScores.stability, 0)
})

test('fails nodes outside 1920x1080 and severely overlapping business panels', () => {
  const document = passingDocument()
  const flightTrend = document.children.find(node => node.id === 'flight-trend')
  const airspaceUsage = document.children.find(node => node.id === 'airspace-usage')
  flightTrend.$dashboard.rect = rect(1700, 900, 580, 300)
  airspaceUsage.$dashboard.rect = rect(1710, 910, 580, 300)

  const result = evaluateLowAltitudeDashboard({
    scenarioId: 'EVAL-LA-03',
    dashboardDocument: document,
    runtimeStatus: 'COMPLETED',
    toolCallReceipts: [appliedReceipt],
    consoleErrors: [],
  })

  assert.equal(result.hardGatePassed, false)
  assert.ok(result.failureTags.includes('OUT_OF_BOUNDS'))
  assert.ok(result.failureTags.includes('SERIOUS_OVERLAP'))
  assert.deepEqual(result.evidence.outOfBoundsNodeIds.sort(), ['airspace-usage', 'flight-trend'])
  assert.deepEqual(result.evidence.seriousOverlapPairs, [['flight-trend', 'airspace-usage']])
})

test('passes exact requested KPI values and units on the ordinary generation path', () => {
  const document = passingDocument()
  document.children.find(node => node.id === 'kpi-flights').props.text = '今日飞行 128 架次'
  document.children.find(node => node.id === 'kpi-aircraft').props.text = '执行中任务 18 个'
  document.children.find(node => node.id === 'kpi-alerts').props.text = '告警事件 5 起'

  const result = evaluateLowAltitudeDashboard({
    scenarioId: 'EVAL-LA-04',
    dashboardDocument: document,
    runtimeStatus: 'COMPLETED',
    toolCallReceipts: [appliedReceipt],
    consoleErrors: [],
  })

  assert.equal(result.hardGatePassed, true)
  assert.equal(result.evidence.exactKpiMatchCount, 4)
  assert.equal(result.evidence.writePolicyPassed, true)
})

test('fails exact KPI generation when a requested value is changed', () => {
  const document = passingDocument()
  document.children.find(node => node.id === 'kpi-flights').props.text = '今日飞行 129 架次'
  document.children.find(node => node.id === 'kpi-aircraft').props.text = '执行中任务 18 个'
  document.children.find(node => node.id === 'kpi-alerts').props.text = '告警事件 5 起'

  const result = evaluateLowAltitudeDashboard({
    scenarioId: 'EVAL-LA-04',
    dashboardDocument: document,
    runtimeStatus: 'COMPLETED',
    toolCallReceipts: [appliedReceipt],
    consoleErrors: [],
  })

  assert.equal(result.hardGatePassed, false)
  assert.ok(result.failureTags.includes('EXACT_KPIS_MISMATCH'))
  assert.equal(result.evidence.exactKpiMatchCount, 3)
})

test('fails ordinary generation when it automatically uses artifact.createOnline', () => {
  const result = evaluateLowAltitudeDashboard({
    scenarioId: 'EVAL-LA-04',
    dashboardDocument: onlineDocument(),
    renderedText: '彭州低空经济运营态势 今日飞行 128 架次 执行中任务 18 个 告警事件 5 起 起降点在线率 98.6%',
    runtimeStatus: 'COMPLETED',
    toolCallReceipts: [onlineReceipt('artifact.createOnline')],
    onlineArtifactEvidence: {
      lifecycleReady: true,
      fullCanvas: true,
      visualSectionCount: 4,
    },
    consoleErrors: [],
  })

  assert.equal(result.hardGatePassed, false)
  assert.ok(result.failureTags.includes('ORDINARY_WRITE_PATH_VIOLATION'))
  assert.equal(result.evidence.writePolicyPassed, false)
})

test('passes an incremental KPI adjustment that changes only the requested node', () => {
  const initialDocument = lowAltitudeDashboardDocument()
  const dashboardDocument = structuredClone(initialDocument)
  dashboardDocument.children[0].props.data.kpis[0].value = 320

  const result = evaluateLowAltitudeDashboard({
    scenarioId: 'EVAL-LA-05',
    initialDashboardDocument: initialDocument,
    dashboardDocument,
    requestedChangeNodeIds: ['low-altitude-dashboard'],
    runtimeStatus: 'COMPLETED',
    toolCallReceipts: [appliedReceipt],
    consoleErrors: [],
  })

  assert.equal(result.hardGatePassed, true)
  assert.equal(result.evidence.incrementalPreservationVerified, true)
  assert.equal(result.evidence.exactKpiMatchCount, 1)
  assert.deepEqual(result.evidence.changedNodeIds, ['low-altitude-dashboard'])
})

test('fails an incremental adjustment that also changes unspecified content', () => {
  const initialDocument = passingDocument()
  const dashboardDocument = structuredClone(initialDocument)
  dashboardDocument.children.find(node => node.id === 'kpi-flights').props.text = '今日飞行 320 架次'
  dashboardDocument.children.find(node => node.id === 'airspace-usage').title = '未经请求改写的图表'

  const result = evaluateLowAltitudeDashboard({
    scenarioId: 'EVAL-LA-05',
    initialDashboardDocument: initialDocument,
    dashboardDocument,
    requestedChangeNodeIds: ['kpi-flights'],
    runtimeStatus: 'COMPLETED',
    toolCallReceipts: [appliedReceipt],
    consoleErrors: [],
  })

  assert.equal(result.hardGatePassed, false)
  assert.ok(result.failureTags.includes('UNSPECIFIED_CONTENT_CHANGED'))
  assert.equal(result.evidence.incrementalPreservationVerified, false)
  assert.deepEqual(result.evidence.changedNodeIds.sort(), ['airspace-usage', 'kpi-flights'])
})

test('enforces the optional 45 second execution budget when elapsedMs is supplied', () => {
  const result = evaluateLowAltitudeDashboard({
    dashboardDocument: passingDocument(),
    runtimeStatus: 'COMPLETED',
    toolCallReceipts: [appliedReceipt],
    elapsedMs: 45_001,
    consoleErrors: [],
  })

  assert.equal(result.hardGatePassed, false)
  assert.ok(result.failureTags.includes('EXECUTION_TIMEOUT'))
  assert.equal(result.evidence.executionWithinBudget, false)
})
