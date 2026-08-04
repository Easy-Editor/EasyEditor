const deepFreeze = value => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  Object.freeze(value)
  for (const nested of Object.values(value)) deepFreeze(nested)
  return value
}

export const LOW_ALTITUDE_DASHBOARD_EVAL_SCENARIOS = deepFreeze([
  {
    id: 'EVAL-LA-01',
    name: '低空经济运营态势大屏生成',
    prompt:
      '直接在当前 1920×1080 画布生成低空经济运营态势大屏，包含标题、4 个核心指标、飞行架次趋势、航空器类型或起降点业务图表、实时告警和中心态势区。',
    minimums: { kpis: 4, validBusinessCharts: 2 },
  },
  {
    id: 'EVAL-LA-02',
    name: '低空飞行安全监测大屏生成',
    prompt:
      '生成低空飞行安全监测大屏，突出在飞航空器、今日飞行架次、告警事件、起降点在线率，并用真实低空业务字段配置至少两个图表。',
    minimums: { kpis: 4, validBusinessCharts: 2 },
  },
  {
    id: 'EVAL-LA-03',
    name: '低空大屏质量回归',
    prompt:
      '检查并补齐当前低空大屏，使其完成真实画布写入、业务语义明确、图表数据可用、无默认浏览器或设备演示数据，并保持 1920×1080 内无严重重叠。',
    minimums: { kpis: 4, validBusinessCharts: 2 },
  },
  {
    id: 'EVAL-LA-04',
    name: '低空大屏精确 KPI 生成',
    prompt:
      '直接用现有大屏物料生成低空经济运营态势大屏。4 个 KPI 必须精确为：今日飞行 128 架次、执行中任务 18 个、告警事件 5 起、起降点在线率 98.6%。不得改写数值或单位，不要创建在线组件。',
    minimums: { kpis: 4, validBusinessCharts: 2 },
    requirements: {
      exactKpis: [
        { label: '今日飞行', value: 128, unit: '架次' },
        { label: '执行中任务', value: 18, unit: '个' },
        { label: '告警事件', value: 5, unit: '起' },
        { label: '起降点在线率', value: 98.6, unit: '%' },
      ],
      writePolicy: 'screen.applyChangeSet-only',
    },
  },
  {
    id: 'EVAL-LA-05',
    name: '低空大屏增量 KPI 调整',
    prompt:
      '当前低空大屏已有完整内容。只将“今日飞行”的值调整为 320，保留单位“架次”，其他 KPI、图表数据、布局、组件和文案全部保持不变。',
    minimums: { kpis: 4, validBusinessCharts: 2 },
    requirements: {
      exactKpis: [{ label: '今日飞行', value: 320, unit: '架次' }],
      preserveUnspecifiedContent: true,
      writePolicy: 'screen.applyChangeSet-only',
    },
  },
])

const FAILURE_TAGS = Object.freeze({
  CANVAS_UNCHANGED: 'CANVAS_UNCHANGED',
  CONSOLE_ERRORS: 'CONSOLE_ERRORS',
  DEFAULT_DEMO_DATA: 'DEFAULT_DEMO_DATA',
  EXACT_KPIS_MISMATCH: 'EXACT_KPIS_MISMATCH',
  EXECUTION_TIMEOUT: 'EXECUTION_TIMEOUT',
  INCOMPLETE_RUNTIME: 'INCOMPLETE_RUNTIME',
  INSUFFICIENT_BUSINESS_CHARTS: 'INSUFFICIENT_BUSINESS_CHARTS',
  INSUFFICIENT_KPIS: 'INSUFFICIENT_KPIS',
  LOW_ALTITUDE_SEMANTICS_MISSING: 'LOW_ALTITUDE_SEMANTICS_MISSING',
  ONLINE_ARTIFACT_INVALID: 'ONLINE_ARTIFACT_INVALID',
  ORDINARY_WRITE_PATH_VIOLATION: 'ORDINARY_WRITE_PATH_VIOLATION',
  OUT_OF_BOUNDS: 'OUT_OF_BOUNDS',
  SERIOUS_OVERLAP: 'SERIOUS_OVERLAP',
  UNSPECIFIED_CONTENT_CHANGED: 'UNSPECIFIED_CONTENT_CHANGED',
  WRITE_NOT_APPLIED: 'WRITE_NOT_APPLIED',
})

const LOW_ALTITUDE_PATTERNS = [
  /低空/i,
  /飞行|飞行器|航空器/i,
  /无人机|eVTOL/i,
  /架次/i,
  /空域|航线/i,
  /起降点|起降场|机场/i,
  /告警|预警/i,
  /运营|态势|监管/i,
]

const KPI_PATTERNS = [
  /今日.*(?:飞行|架次)|(?:飞行|架次).*今日/i,
  /在飞.*(?:航空器|飞行器|无人机)|(?:航空器|飞行器|无人机).*在飞/i,
  /在线.*(?:航空器|飞行器|无人机)|(?:航空器|飞行器|无人机).*在线/i,
  /告警|预警|异常事件/i,
  /起降点.*在线率|在线率.*起降点/i,
  /累计.*(?:飞行|架次)|(?:飞行|架次).*累计/i,
  /飞行时长|飞行里程/i,
  /任务.*(?:数量|总数|执行中)|执行中.*任务/i,
  /航线.*(?:数量|总数)|(?:数量|总数).*航线/i,
  /空域.*(?:数量|总数|使用率)|(?:数量|总数|使用率).*空域/i,
]

const DEFAULT_DEMO_PATTERN = /\b(?:desktop|mobile|chrome|safari)\b/i
const COMPLETED_STATUS_PATTERN = /^(?:COMPLETED|complete|completed|success|succeeded)$/i
const CHART_PATTERN = /chart/i
const ONLINE_ARTIFACT_COMPONENT_PATTERN = /GeneratedMaterialHost/i
const LOW_ALTITUDE_DASHBOARD_COMPONENT = 'LowAltitudeDashboard'
const WRITE_CAPABILITIES = new Set(['artifact.createOnline', 'artifact.reviseOnline', 'screen.applyChangeSet'])
const EXECUTION_BUDGET_MS = 45_000

const isObject = value => value !== null && typeof value === 'object'
const finiteNumber = value => typeof value === 'number' && Number.isFinite(value)

const collectStrings = value => {
  const output = []
  const seen = new WeakSet()
  const visit = current => {
    if (typeof current === 'string') {
      output.push(current)
      return
    }
    if (!isObject(current) || seen.has(current)) return
    seen.add(current)
    for (const nested of Object.values(current)) visit(nested)
  }
  visit(value)
  return output
}

const resolveRoots = input => {
  const candidate =
    input.dashboardDocument ??
    input.document ??
    input.dashboardSchema ??
    input.schema ??
    input.nodes ??
    input.projectSchema ??
    null
  if (Array.isArray(candidate)) return candidate
  if (!isObject(candidate)) return []
  if (Array.isArray(candidate.componentsTree)) return candidate.componentsTree
  if (isObject(candidate.schema)) return resolveRoots({ schema: candidate.schema })
  if (Array.isArray(candidate.children) || candidate.componentName) return [candidate]
  return []
}

const flattenNodes = roots => {
  const output = []
  const seen = new WeakSet()
  const visit = (node, ancestors, depth) => {
    if (!isObject(node) || seen.has(node)) return
    seen.add(node)
    const id = typeof node.id === 'string' ? node.id : `anonymous-${output.length}`
    output.push({ node, id, ancestors, depth })
    const nextAncestors = new Set(ancestors)
    nextAncestors.add(id)
    if (Array.isArray(node.children)) {
      for (const child of node.children) visit(child, nextAncestors, depth + 1)
    }
  }
  for (const root of roots) visit(root, new Set(), 0)
  return output
}

const getRect = node => {
  const rect = node?.$dashboard?.rect ?? node?.rect ?? node?.props?.rect
  if (!isObject(rect)) return null
  const { x, y, width, height } = rect
  return [x, y, width, height].every(finiteNumber) ? { x, y, width, height } : null
}

const getCanvasSize = () => ({ width: 1920, height: 1080 })

const chartSeriesKeys = series => {
  if (!Array.isArray(series)) return []
  return series
    .map(item => {
      if (typeof item === 'string') return item
      if (!isObject(item)) return null
      return item.dataKey ?? item.key ?? item.field ?? item.valueKey ?? null
    })
    .filter(key => typeof key === 'string' && key.length > 0)
}

const isValidBusinessChart = node => {
  if (!CHART_PATTERN.test(String(node?.componentName ?? ''))) return false
  const props = isObject(node.props) ? node.props : {}
  if (!Array.isArray(props.data) || props.data.length === 0 || typeof props.xKey !== 'string' || !props.xKey) {
    return false
  }
  const seriesKeys = chartSeriesKeys(props.series)
  if (seriesKeys.length === 0) return false
  return props.data.every(
    row =>
      isObject(row) && Object.hasOwn(row, props.xKey) && seriesKeys.every(seriesKey => Object.hasOwn(row, seriesKey)),
  )
}

const nonEmptyString = value => typeof value === 'string' && value.trim().length > 0

const validValueSeries = value =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every(item => isObject(item) && nonEmptyString(item.label) && finiteNumber(item.value))

const validRoutes = value =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every(item => isObject(item) && nonEmptyString(item.from) && nonEmptyString(item.to))

const validAlerts = value =>
  Array.isArray(value) &&
  value.length > 0 &&
  value.every(
    item => isObject(item) && nonEmptyString(item.time) && nonEmptyString(item.level) && nonEmptyString(item.text),
  )

const countBuiltInBusinessSections = node => {
  if (node?.componentName !== LOW_ALTITUDE_DASHBOARD_COMPONENT) return 0
  const data = node?.props?.data
  if (!isObject(data)) return 0
  return [
    validValueSeries(data.flightTrend),
    validValueSeries(data.taskMix),
    validRoutes(data.routes),
    validAlerts(data.alerts),
  ].filter(Boolean).length
}

const parseAppliedWriteReceipt = value => {
  if (!isObject(value) || !Object.hasOwn(value, 'capability') || !WRITE_CAPABILITIES.has(value.capability)) {
    return null
  }
  const receipt =
    Object.hasOwn(value, 'receipt') && isObject(value.receipt)
      ? value.receipt
      : Object.hasOwn(value, 'result') && isObject(value.result)
        ? value.result
        : null
  if (
    !receipt ||
    !Object.hasOwn(receipt, 'schemaVersion') ||
    !Object.hasOwn(receipt, 'callId') ||
    !Object.hasOwn(receipt, 'status') ||
    !Object.hasOwn(receipt, 'revision') ||
    receipt.schemaVersion !== 1 ||
    receipt.status !== 'applied' ||
    !nonEmptyString(receipt.callId) ||
    !nonEmptyString(receipt.revision) ||
    Object.hasOwn(receipt, 'failure')
  ) {
    return null
  }
  return { capability: value.capability, callId: receipt.callId, revision: receipt.revision }
}

const receiptHasOnlineArtifactWrite = receipt =>
  ['artifact.createOnline', 'artifact.reviseOnline'].includes(parseAppliedWriteReceipt(receipt)?.capability)

const appliedWriteCapabilities = receipts => [
  ...new Set(
    receipts
      .map(parseAppliedWriteReceipt)
      .filter(Boolean)
      .map(({ capability }) => capability),
  ),
]

const attemptedWriteCapabilities = receipts => [
  ...new Set(
    receipts
      .filter(receipt => isObject(receipt) && WRITE_CAPABILITIES.has(receipt.capability))
      .map(receipt => receipt.capability),
  ),
]

const runtimeCompleted = runtimeStatus => {
  if (typeof runtimeStatus === 'string') return COMPLETED_STATUS_PATTERN.test(runtimeStatus)
  return collectStrings(runtimeStatus).some(value => COMPLETED_STATUS_PATTERN.test(value))
}

const countSemanticMatches = (patterns, corpus) => patterns.filter(pattern => pattern.test(corpus)).length

const normalizeKpiText = value => String(value).replace(/\s+/g, '').toLowerCase()

const objectMatchesExactKpi = (value, requirement) => {
  if (!isObject(value)) return false
  const label = value.label ?? value.title ?? value.name
  const actualValue = value.value ?? value.count ?? value.total
  const unit = value.unit ?? ''
  return (
    typeof label === 'string' &&
    normalizeKpiText(label).includes(normalizeKpiText(requirement.label)) &&
    normalizeKpiText(actualValue) === normalizeKpiText(requirement.value) &&
    normalizeKpiText(unit) === normalizeKpiText(requirement.unit)
  )
}

const matchesExactKpi = (roots, renderedText, requirement) => {
  const expectedText = normalizeKpiText(`${requirement.label}${requirement.value}${requirement.unit}`)
  if ([...collectStrings(roots), renderedText].some(value => normalizeKpiText(value).includes(expectedText))) {
    return true
  }
  const seen = new WeakSet()
  const visit = value => {
    if (!isObject(value) || seen.has(value)) return false
    seen.add(value)
    if (objectMatchesExactKpi(value, requirement)) return true
    return Object.values(value).some(visit)
  }
  return roots.some(visit)
}

const comparableNode = node => {
  const output = {}
  for (const [key, value] of Object.entries(node)) {
    output[key] =
      key === 'children' && Array.isArray(value)
        ? value.map(child => (typeof child?.id === 'string' ? child.id : null))
        : value
  }
  return output
}

const changedNodeIdsBetween = (initialRoots, currentRoots) => {
  const initialNodes = new Map(flattenNodes(initialRoots).map(({ id, node }) => [id, comparableNode(node)]))
  const currentNodes = new Map(flattenNodes(currentRoots).map(({ id, node }) => [id, comparableNode(node)]))
  const ids = new Set([...initialNodes.keys(), ...currentNodes.keys()])
  return [...ids].filter(id => JSON.stringify(initialNodes.get(id)) !== JSON.stringify(currentNodes.get(id))).sort()
}

const hasCanvasChanged = ({ input, nodes, writeApplied }) => {
  const initial = input.initialDashboardDocument ?? input.initialDocument ?? input.initialSchema
  if (initial !== undefined) {
    try {
      return (
        JSON.stringify(initial) !==
        JSON.stringify(input.dashboardDocument ?? input.document ?? input.schema ?? input.nodes)
      )
    } catch {
      return false
    }
  }
  return writeApplied && nodes.some(({ depth, node }) => depth > 0 && node.componentName)
}

const layoutViolations = (nodes, canvas) => {
  const visualNodes = nodes
    .map(entry => ({ ...entry, rect: getRect(entry.node) }))
    .filter(entry => entry.depth > 0 && entry.rect)
  const outOfBounds = visualNodes.filter(({ rect }) => {
    const { x, y, width, height } = rect
    return width <= 0 || height <= 0 || x < 0 || y < 0 || x + width > canvas.width || y + height > canvas.height
  })
  const seriousOverlaps = []
  for (let leftIndex = 0; leftIndex < visualNodes.length; leftIndex += 1) {
    const left = visualNodes[leftIndex]
    if (/^(?:Root|Container|Group|Image)$/i.test(String(left.node.componentName ?? ''))) continue
    for (let rightIndex = leftIndex + 1; rightIndex < visualNodes.length; rightIndex += 1) {
      const right = visualNodes[rightIndex]
      if (/^(?:Root|Container|Group|Image)$/i.test(String(right.node.componentName ?? ''))) continue
      if (left.ancestors.has(right.id) || right.ancestors.has(left.id)) continue
      const overlapWidth = Math.max(
        0,
        Math.min(left.rect.x + left.rect.width, right.rect.x + right.rect.width) - Math.max(left.rect.x, right.rect.x),
      )
      const overlapHeight = Math.max(
        0,
        Math.min(left.rect.y + left.rect.height, right.rect.y + right.rect.height) -
          Math.max(left.rect.y, right.rect.y),
      )
      const overlapArea = overlapWidth * overlapHeight
      const smallerArea = Math.min(left.rect.width * left.rect.height, right.rect.width * right.rect.height)
      if (smallerArea >= 1_000 && overlapArea / smallerArea >= 0.72) {
        seriousOverlaps.push([left.id, right.id])
      }
    }
  }
  return { outOfBounds, seriousOverlaps, visualNodeCount: visualNodes.length }
}

const weightedScore = dimensionScores => {
  const weights = {
    execution: 0.2,
    lowAltitudeSemantics: 0.15,
    kpis: 0.15,
    businessCharts: 0.15,
    chartDataQuality: 0.15,
    layout: 0.15,
    stability: 0.05,
  }
  return Math.round(
    Object.entries(weights).reduce((total, [dimension, weight]) => total + dimensionScores[dimension] * weight, 0),
  )
}

export const evaluateLowAltitudeDashboard = input => {
  const safeInput = isObject(input) ? input : {}
  const scenario =
    LOW_ALTITUDE_DASHBOARD_EVAL_SCENARIOS.find(item => item.id === safeInput.scenarioId) ??
    LOW_ALTITUDE_DASHBOARD_EVAL_SCENARIOS[0]
  const roots = resolveRoots(safeInput)
  const nodes = flattenNodes(roots)
  const receipts = Array.isArray(safeInput.toolCallReceipts) ? safeInput.toolCallReceipts : []
  const consoleErrors = Array.isArray(safeInput.consoleErrors)
    ? safeInput.consoleErrors.filter(error => error !== null && error !== undefined && String(error).length > 0)
    : []
  const renderedText = typeof safeInput.renderedText === 'string' ? safeInput.renderedText : ''
  const corpus = [...collectStrings(roots), renderedText].join(' ')
  const completed = runtimeCompleted(safeInput.runtimeStatus)
  const writeCapabilities = appliedWriteCapabilities(receipts)
  const writeApplied = writeCapabilities.length > 0
  const attemptedCapabilities = attemptedWriteCapabilities(receipts)
  const canvasChanged = hasCanvasChanged({ input: safeInput, nodes, writeApplied })
  const semanticMatchCount = countSemanticMatches(LOW_ALTITUDE_PATTERNS, corpus)
  const kpiCount = countSemanticMatches(KPI_PATTERNS, corpus)
  const exactKpis = Array.isArray(scenario.requirements?.exactKpis) ? scenario.requirements.exactKpis : []
  const exactKpiMatchCount = exactKpis.filter(requirement => matchesExactKpi(roots, renderedText, requirement)).length
  const exactKpisPassed = exactKpiMatchCount === exactKpis.length
  const chartNodes = nodes.filter(({ node }) => CHART_PATTERN.test(String(node.componentName ?? '')))
  const validBusinessCharts = chartNodes.filter(({ node }) => isValidBusinessChart(node))
  const validBuiltInBusinessSectionCount = nodes.reduce(
    (total, { node }) => total + countBuiltInBusinessSections(node),
    0,
  )
  const validBusinessVisualCount = validBusinessCharts.length + validBuiltInBusinessSectionCount
  const onlineArtifact =
    receipts.some(receiptHasOnlineArtifactWrite) ||
    nodes.some(({ node }) => ONLINE_ARTIFACT_COMPONENT_PATTERN.test(String(node.componentName ?? '')))
  const onlineArtifactEvidence = isObject(safeInput.onlineArtifactEvidence) ? safeInput.onlineArtifactEvidence : {}
  const onlineLifecycleReady = onlineArtifactEvidence.lifecycleReady === true
  const onlineFullCanvas = onlineArtifactEvidence.fullCanvas === true
  const onlineVisualSectionCount = finiteNumber(onlineArtifactEvidence.visualSectionCount)
    ? Math.max(0, Math.floor(onlineArtifactEvidence.visualSectionCount))
    : 0
  const onlineBusinessSectionsReady = onlineVisualSectionCount >= scenario.minimums.validBusinessCharts
  const onlineArtifactValid = onlineArtifact && onlineLifecycleReady && onlineFullCanvas && onlineBusinessSectionsReady
  const hasDefaultDemoData = DEFAULT_DEMO_PATTERN.test(corpus)
  const layout = layoutViolations(nodes, getCanvasSize())
  const writePolicyPassed =
    scenario.requirements?.writePolicy !== 'screen.applyChangeSet-only' ||
    (attemptedCapabilities.length > 0 &&
      attemptedCapabilities.every(capability => capability === 'screen.applyChangeSet'))
  const initialDocument = safeInput.initialDashboardDocument ?? safeInput.initialDocument ?? safeInput.initialSchema
  const requestedChangeNodeIds = Array.isArray(safeInput.requestedChangeNodeIds)
    ? [...new Set(safeInput.requestedChangeNodeIds.filter(id => typeof id === 'string' && id.length > 0))].sort()
    : []
  const changedNodeIds =
    initialDocument === undefined ? [] : changedNodeIdsBetween(resolveRoots({ document: initialDocument }), roots)
  const incrementalPreservationRequired = scenario.requirements?.preserveUnspecifiedContent === true
  const incrementalPreservationVerified =
    !incrementalPreservationRequired ||
    (requestedChangeNodeIds.length > 0 &&
      changedNodeIds.length === requestedChangeNodeIds.length &&
      changedNodeIds.every(id => requestedChangeNodeIds.includes(id)))
  const elapsedMsSupplied = Object.hasOwn(safeInput, 'elapsedMs')
  const executionWithinBudget =
    !elapsedMsSupplied ||
    (finiteNumber(safeInput.elapsedMs) && safeInput.elapsedMs >= 0 && safeInput.elapsedMs <= EXECUTION_BUDGET_MS)

  const failureTags = []
  if (!completed) failureTags.push(FAILURE_TAGS.INCOMPLETE_RUNTIME)
  if (!writeApplied) failureTags.push(FAILURE_TAGS.WRITE_NOT_APPLIED)
  if (!canvasChanged) failureTags.push(FAILURE_TAGS.CANVAS_UNCHANGED)
  if (semanticMatchCount < 3) failureTags.push(FAILURE_TAGS.LOW_ALTITUDE_SEMANTICS_MISSING)
  if (kpiCount < scenario.minimums.kpis) failureTags.push(FAILURE_TAGS.INSUFFICIENT_KPIS)
  if (!exactKpisPassed) failureTags.push(FAILURE_TAGS.EXACT_KPIS_MISMATCH)
  if (!writePolicyPassed) failureTags.push(FAILURE_TAGS.ORDINARY_WRITE_PATH_VIOLATION)
  if (!incrementalPreservationVerified) failureTags.push(FAILURE_TAGS.UNSPECIFIED_CONTENT_CHANGED)
  if (!executionWithinBudget) failureTags.push(FAILURE_TAGS.EXECUTION_TIMEOUT)
  if (onlineArtifact && !onlineArtifactValid) {
    failureTags.push(FAILURE_TAGS.ONLINE_ARTIFACT_INVALID)
  } else if (!onlineArtifact && validBusinessVisualCount < scenario.minimums.validBusinessCharts) {
    failureTags.push(FAILURE_TAGS.INSUFFICIENT_BUSINESS_CHARTS)
  }
  if (hasDefaultDemoData) failureTags.push(FAILURE_TAGS.DEFAULT_DEMO_DATA)
  if (layout.outOfBounds.length > 0) failureTags.push(FAILURE_TAGS.OUT_OF_BOUNDS)
  if (layout.seriousOverlaps.length > 0) failureTags.push(FAILURE_TAGS.SERIOUS_OVERLAP)
  if (consoleErrors.length > 0) failureTags.push(FAILURE_TAGS.CONSOLE_ERRORS)

  const dimensionScores = {
    execution: Math.round(((Number(completed) + Number(writeApplied) + Number(canvasChanged)) / 3) * 100),
    lowAltitudeSemantics: Math.min(100, Math.round((semanticMatchCount / 4) * 100)),
    kpis: Math.min(100, Math.round((kpiCount / scenario.minimums.kpis) * 100)),
    businessCharts: Math.min(
      100,
      Math.round(
        ((onlineArtifact ? onlineVisualSectionCount : chartNodes.length + validBuiltInBusinessSectionCount) /
          scenario.minimums.validBusinessCharts) *
          100,
      ),
    ),
    chartDataQuality: onlineArtifact
      ? onlineLifecycleReady && onlineBusinessSectionsReady
        ? 100
        : 0
      : Math.min(100, Math.round((validBusinessVisualCount / scenario.minimums.validBusinessCharts) * 100)),
    layout:
      layout.outOfBounds.length === 0 &&
      layout.seriousOverlaps.length === 0 &&
      layout.visualNodeCount > 0 &&
      (!onlineArtifact || onlineFullCanvas)
        ? 100
        : 0,
    stability: consoleErrors.length === 0 && !hasDefaultDemoData && executionWithinBudget ? 100 : 0,
  }

  return {
    scenarioId: scenario.id,
    hardGatePassed: failureTags.length === 0,
    score: weightedScore(dimensionScores),
    dimensionScores,
    failureTags,
    evidence: {
      canvasChanged,
      completed,
      consoleErrorCount: consoleErrors.length,
      defaultDemoDataFound: hasDefaultDemoData,
      changedNodeIds,
      elapsedMs: elapsedMsSupplied ? safeInput.elapsedMs : null,
      exactKpiMatchCount,
      exactKpiRequiredCount: exactKpis.length,
      executionBudgetMs: EXECUTION_BUDGET_MS,
      executionWithinBudget,
      incrementalPreservationVerified,
      kpiCount,
      onlineArtifact,
      onlineArtifactLifecycleReady: onlineLifecycleReady,
      onlineArtifactFullCanvas: onlineFullCanvas,
      onlineVisualSectionCount,
      outOfBoundsNodeIds: layout.outOfBounds.map(({ id }) => id),
      semanticMatchCount,
      seriousOverlapPairs: layout.seriousOverlaps,
      attemptedWriteCapabilities: attemptedCapabilities,
      validBuiltInBusinessSectionCount,
      validBusinessChartCount: validBusinessCharts.length,
      validBusinessVisualCount,
      writeCapabilities,
      writeApplied,
      writePolicyPassed,
    },
  }
}
