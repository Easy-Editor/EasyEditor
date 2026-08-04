export const DASHBOARD_SCENE_VERSION = 1 as const
export const DASHBOARD_SCENE_WIDTH = 480
export const DASHBOARD_SCENE_HEIGHT = 280
export const DASHBOARD_SCENE_MIN_WIDTH = 320
export const DASHBOARD_SCENE_MIN_HEIGHT = 180
export const DASHBOARD_SCENE_MAX_WIDTH = 3840
export const DASHBOARD_SCENE_MAX_HEIGHT = 2160
export const DASHBOARD_SCENE_MAX_WIDGETS = 24

export type DashboardSceneWidgetKind = 'kpi' | 'combo-map' | 'table' | 'rank' | 'line' | 'donut' | 'cluster'

export interface DashboardSceneRect {
  x: number
  y: number
  width: number
  height: number
}

export interface DashboardSceneSeries {
  key: string
  label: string
  color: string
}

export interface DashboardSceneLineWidgetData {
  showLegend?: boolean
  showYAxis?: boolean
  showAllXTicks?: boolean
  horizontalGrid?: boolean
  yDomain?: [number, number]
  yTicks?: number[]
  verticalGrid?: boolean
  dotRadius?: number
  [key: string]: unknown
}

export interface DashboardSceneComboMapWidgetData {
  mapScale?: number
  mapWidthPercent?: number
  chartYDomain?: [number, number]
  chartYTicks?: number[]
  activeTab?: string
  selectedProvince?: string
  tabViews?: Record<string, DashboardSceneComboMapViewData>
  provinceViews?: Record<string, DashboardSceneComboMapViewData>
  [key: string]: unknown
}

export interface DashboardSceneComboMapViewData {
  chart?: Array<Record<string, unknown>>
  categories?: unknown[]
  bars?: unknown[]
  lines?: unknown[]
  regions?: unknown[]
  highlights?: unknown[]
  legend?: unknown[]
  chartYDomain?: [number, number]
  chartYTicks?: number[]
  mapScale?: number
  [key: string]: unknown
}

export interface DashboardSceneComboMapSelection {
  tabKey?: string
  tabLabel?: string
  provinceKey?: string
  provinceLabel?: string
}

export interface DashboardSceneTableWidgetData {
  fontSize?: number
  rankIcons?: boolean
  [key: string]: unknown
}

export interface DashboardSceneDonutWidgetData {
  chartWidthPercent?: number
  legendFontSize?: number
  [key: string]: unknown
}

export interface DashboardSceneClusterLayerData {
  blur?: number
  color?: string
  id?: string
  offsetX?: number
  offsetY?: number
  opacity?: number
  rotation?: number
  scale?: number
}

export interface DashboardSceneClusterItemData {
  color?: string
  fontSize?: number
  fontWeight?: number
  id?: string
  label: string
  layers?: DashboardSceneClusterLayerData[]
  rotation?: number
  scale?: number
  size?: number
  x?: number
  y?: number
  zIndex?: number
}

export interface DashboardSceneClusterWidgetData {
  animate?: boolean
  centerItem?: string
  items: Array<string | DashboardSceneClusterItemData>
  motion?: 'float' | 'none'
  [key: string]: unknown
}

export interface DashboardSceneGeoJsonFeatureCollection {
  type: 'FeatureCollection'
  features: Array<{
    type: 'Feature'
    properties: { name: string }
    geometry: {
      type: 'Polygon' | 'MultiPolygon'
      coordinates: number[][][] | number[][][][]
    }
  }>
}

export interface DashboardSceneWidget {
  id: string
  kind: DashboardSceneWidgetKind
  title: string
  rect: DashboardSceneRect
  chrome?: 'none'
  data?: unknown
}

export interface DashboardSceneSpec {
  version: typeof DASHBOARD_SCENE_VERSION
  canvas: { width: number; height: number }
  header: {
    title: string
    subtitle: string
    brand: string
    showHeader: boolean
    showClock: boolean
  }
  theme: {
    background: string
    surface: string
    surfaceStrong: string
    text: string
    muted: string
    accent: string
    negative: string
    positive: string
    grid: string
    border: string
  }
  map?: DashboardSceneGeoJsonFeatureCollection
  widgets: DashboardSceneWidget[]
}

const DEFAULT_THEME: DashboardSceneSpec['theme'] = {
  background: '#eef3f7',
  surface: '#ffffff',
  surfaceStrong: '#9aa6b7',
  text: '#252d36',
  muted: '#7d8794',
  accent: '#c6a36c',
  negative: '#d7192d',
  positive: '#19b96b',
  grid: '#d8dee6',
  border: '#e3e8ee',
}

const WIDGET_KINDS = new Set<DashboardSceneWidgetKind>([
  'kpi',
  'combo-map',
  'table',
  'rank',
  'line',
  'donut',
  'cluster',
])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const comboMapView = (views: unknown, key = '', label = '') => {
  if (!isRecord(views)) return {}
  const selected = views[key] ?? views[label]
  return isRecord(selected) ? selected : {}
}

export const resolveDashboardSceneComboMapData = (
  value: unknown,
  selection: DashboardSceneComboMapSelection,
): DashboardSceneComboMapWidgetData => {
  const data = isRecord(value) ? value : {}
  return {
    ...data,
    ...comboMapView(data.tabViews, selection.tabKey, selection.tabLabel),
    ...comboMapView(data.provinceViews, selection.provinceKey, selection.provinceLabel),
  }
}

const text = (value: unknown, fallback = '', maxLength = 160) =>
  typeof value === 'string' ? value.slice(0, maxLength) : fallback

const finite = (value: unknown, fallback: number, min: number, max: number) => {
  const candidate = typeof value === 'number' && Number.isFinite(value) ? value : fallback
  return Math.min(max, Math.max(min, candidate))
}

const color = (value: unknown, fallback: string) => {
  const candidate = text(value, '', 48).trim()
  return /^(#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([^)]{1,40}\)|var\(--[a-z0-9-]{1,32}\))$/iu.test(candidate)
    ? candidate
    : fallback
}

const canvasDimension = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max ? value : fallback

const rect = (
  value: unknown,
  fallback: DashboardSceneRect,
  canvas: DashboardSceneSpec['canvas'],
): DashboardSceneRect => {
  const input = isRecord(value) ? value : {}
  const x = finite(input.x, fallback.x, 0, canvas.width - 1)
  const y = finite(input.y, fallback.y, 0, canvas.height - 1)
  return {
    x,
    y,
    width: finite(input.width, fallback.width, 40, canvas.width - x),
    height: finite(input.height, fallback.height, 40, canvas.height - y),
  }
}

const jsonValue = (value: unknown, depth = 0): unknown => {
  if (depth > 6) return null
  if (value === null || typeof value === 'boolean') return value
  if (typeof value === 'string') return value.slice(0, 512)
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  if (Array.isArray(value)) return value.slice(0, 64).map(item => jsonValue(item, depth + 1))
  if (!isRecord(value)) return null
  const output: Record<string, unknown> = {}
  for (const key of Object.keys(value).slice(0, 48)) {
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
    output[key.slice(0, 64)] = jsonValue(value[key], depth + 1)
  }
  return output
}

export const normalizeDashboardSceneWidgetData = (value: unknown): Record<string, unknown> => {
  const normalized = jsonValue(value)
  return isRecord(normalized) ? normalized : {}
}

export const applyDashboardScenePrimaryWidgetData = (scene: DashboardSceneSpec, value: unknown): DashboardSceneSpec => {
  const widgetData = normalizeDashboardSceneWidgetData(value)
  if (!scene.widgets.length || !Object.keys(widgetData).length) return scene

  const [primaryWidget, ...remainingWidgets] = scene.widgets
  return {
    ...scene,
    widgets: [
      {
        ...primaryWidget,
        data: {
          ...(isRecord(primaryWidget.data) ? primaryWidget.data : {}),
          ...widgetData,
        },
      },
      ...remainingWidgets,
    ],
  }
}

const coordinatePoint = (value: unknown): [number, number] | null => {
  if (!Array.isArray(value) || value.length < 2) return null
  const longitude = finite(value[0], Number.NaN, -180, 180)
  const latitude = finite(value[1], Number.NaN, -90, 90)
  return Number.isFinite(longitude) && Number.isFinite(latitude) ? [longitude, latitude] : null
}

const polygon = (value: unknown): number[][][] => {
  if (!Array.isArray(value)) return []
  return value.slice(0, 32).flatMap(ringValue => {
    if (!Array.isArray(ringValue)) return []
    const ring = ringValue.slice(0, 2048).flatMap(pointValue => {
      const point = coordinatePoint(pointValue)
      return point ? [point] : []
    })
    return ring.length >= 3 ? [ring] : []
  })
}

const mapData = (value: unknown): DashboardSceneGeoJsonFeatureCollection | undefined => {
  if (!isRecord(value) || value.type !== 'FeatureCollection' || !Array.isArray(value.features)) return undefined
  const features: DashboardSceneGeoJsonFeatureCollection['features'] = []
  for (const featureValue of value.features.slice(0, 128)) {
    if (!isRecord(featureValue) || featureValue.type !== 'Feature' || !isRecord(featureValue.geometry)) continue
    const geometryType = featureValue.geometry.type
    if (geometryType !== 'Polygon' && geometryType !== 'MultiPolygon') continue
    const properties = isRecord(featureValue.properties) ? featureValue.properties : {}
    const name = text(properties.name, `区域 ${features.length + 1}`, 80)
    if (geometryType === 'Polygon') {
      const coordinates = polygon(featureValue.geometry.coordinates)
      if (coordinates.length) {
        features.push({ type: 'Feature', properties: { name }, geometry: { type: geometryType, coordinates } })
      }
      continue
    }
    if (!Array.isArray(featureValue.geometry.coordinates)) continue
    const coordinates = featureValue.geometry.coordinates
      .slice(0, 64)
      .map(polygon)
      .filter(item => item.length)
    if (coordinates.length) {
      features.push({ type: 'Feature', properties: { name }, geometry: { type: geometryType, coordinates } })
    }
  }
  return features.length ? { type: 'FeatureCollection', features } : undefined
}

export const normalizeDashboardSceneSpec = (value: unknown): DashboardSceneSpec => {
  const input = isRecord(value) ? value : {}
  const canvasInput = isRecord(input.canvas) ? input.canvas : {}
  const header = isRecord(input.header) ? input.header : {}
  const theme = isRecord(input.theme) ? input.theme : {}
  const widgets = Array.isArray(input.widgets) ? input.widgets : []
  const canvas = {
    width: canvasDimension(
      canvasInput.width,
      DASHBOARD_SCENE_WIDTH,
      DASHBOARD_SCENE_MIN_WIDTH,
      DASHBOARD_SCENE_MAX_WIDTH,
    ),
    height: canvasDimension(
      canvasInput.height,
      DASHBOARD_SCENE_HEIGHT,
      DASHBOARD_SCENE_MIN_HEIGHT,
      DASHBOARD_SCENE_MAX_HEIGHT,
    ),
  }

  return {
    version: DASHBOARD_SCENE_VERSION,
    canvas,
    header: {
      title: text(header.title, '可视化数据报告', 120),
      subtitle: text(header.subtitle, '', 160),
      brand: text(header.brand, 'EASY DASHBOARD', 80),
      showHeader: typeof header.showHeader === 'boolean' ? header.showHeader : true,
      showClock: typeof header.showClock === 'boolean' ? header.showClock : true,
    },
    theme: {
      background: color(theme.background, DEFAULT_THEME.background),
      surface: color(theme.surface, DEFAULT_THEME.surface),
      surfaceStrong: color(theme.surfaceStrong, DEFAULT_THEME.surfaceStrong),
      text: color(theme.text, DEFAULT_THEME.text),
      muted: color(theme.muted, DEFAULT_THEME.muted),
      accent: color(theme.accent, DEFAULT_THEME.accent),
      negative: color(theme.negative, DEFAULT_THEME.negative),
      positive: color(theme.positive, DEFAULT_THEME.positive),
      grid: color(theme.grid, DEFAULT_THEME.grid),
      border: color(theme.border, DEFAULT_THEME.border),
    },
    map: mapData(input.map),
    widgets: widgets.slice(0, DASHBOARD_SCENE_MAX_WIDGETS).flatMap((widgetValue, index) => {
      if (!isRecord(widgetValue) || !WIDGET_KINDS.has(widgetValue.kind as DashboardSceneWidgetKind)) return []
      const kind = widgetValue.kind as DashboardSceneWidgetKind
      const dataSource =
        widgetValue.data === undefined
          ? Object.fromEntries(
              Object.entries(widgetValue).filter(([key]) => !['id', 'kind', 'title', 'rect', 'chrome'].includes(key)),
            )
          : widgetValue.data
      return [
        {
          id: text(widgetValue.id, `widget-${index + 1}`, 80),
          kind,
          title: text(widgetValue.title, '', 120),
          rect: rect(widgetValue.rect, { x: 40, y: 120 + index * 12, width: 440, height: 240 }, canvas),
          ...(widgetValue.chrome === 'none' ? { chrome: 'none' as const } : {}),
          data: jsonValue(dataSource),
        },
      ]
    }),
  }
}

export const defaultLocalizedDashboardSceneSpec: DashboardSceneSpec = normalizeDashboardSceneSpec({
  version: 1,
  canvas: { width: 480, height: 280 },
  header: {
    title: '',
    subtitle: '',
    brand: '',
    showHeader: false,
    showClock: false,
  },
  theme: DEFAULT_THEME,
  widgets: [
    {
      id: 'auto-scrolling-table',
      kind: 'table',
      title: '实时明细',
      rect: { x: 0, y: 0, width: 480, height: 280 },
      data: {
        autoScroll: true,
        columns: ['序号', '名称', '状态', '数值'],
        rows: [
          [1, '示例数据 A', '正常', 128],
          [2, '示例数据 B', '正常', 116],
          [3, '示例数据 C', '关注', 104],
          [4, '示例数据 D', '正常', 98],
          [5, '示例数据 E', '正常', 87],
          [6, '示例数据 F', '关注', 76],
        ],
      },
    },
  ],
})

const months = ['02月', '04月', '06月', '08月', '10月', '12月']

export const bankFinancialSceneDemoSpec: DashboardSceneSpec = normalizeDashboardSceneSpec({
  version: 1,
  canvas: { width: 1920, height: 1080 },
  header: {
    title: '银行2022年度可视化财报',
    subtitle: 'ANNUAL FINANCIAL REPORT',
    brand: 'EASY BANK',
    showHeader: true,
    showClock: true,
  },
  theme: DEFAULT_THEME,
  widgets: [
    {
      id: 'revenue',
      kind: 'kpi',
      title: '营业总收入',
      rect: { x: 48, y: 126, width: 420, height: 172 },
      data: { value: 3023.34, unit: '亿元', change: 4.08, trend: [61, 75, 70, 96, 73, 79], emphasized: true },
    },
    {
      id: 'profit',
      kind: 'kpi',
      title: '净利润',
      rect: { x: 488, y: 126, width: 420, height: 172 },
      data: { value: 1023.43, unit: '亿元', change: 3.21, trend: [51, 60, 50, 73, 60, 66] },
    },
    {
      id: 'loan',
      kind: 'kpi',
      title: '贷款',
      rect: { x: 928, y: 126, width: 420, height: 172 },
      data: { value: 1124.65, unit: '亿元', change: -3.08, trend: [70, 49, 65, 88, 61, 69] },
    },
    {
      id: 'shareholders',
      kind: 'rank',
      title: '八大股东',
      rect: { x: 1368, y: 126, width: 504, height: 600 },
      data: {
        items: [
          ['证券金融股份有限公司A', 32],
          ['某投资有限责任公司A', 22],
          ['钢铁集团有限公司A', 10],
          ['钢铁集团有限公司C', 7],
          ['证券金融股份有限公司B', 6],
          ['某投资有限责任公司B', 6],
          ['某投资有限责任公司C', 6],
          ['钢铁集团有限公司B', 5],
        ],
        unit: '%',
      },
    },
    {
      id: 'branches',
      kind: 'combo-map',
      title: '各省分行营收概况',
      rect: { x: 48, y: 318, width: 860, height: 400 },
      data: {
        emptyMapText: '导入行政区 GeoJSON 后展示区域营收热力',
        highlights: ['浙江', '上海', '重庆'],
        chart: months.map((label, index) => ({
          label,
          profit: [350, 315, 372, 281, 245, 365][index],
          revenue: [680, 570, 830, 610, 430, 870][index],
        })),
      },
    },
    {
      id: 'merchants',
      kind: 'table',
      title: '交易商户概况',
      rect: { x: 928, y: 318, width: 420, height: 400 },
      data: {
        scroll: true,
        columns: ['排行', '商户名称', '笔数', '金额'],
        rows: [
          [8, '商户名称H', 123, 34212],
          [9, '商户名称I', 123, 34212],
          [10, '商户名称J', 123, 34212],
          [1, '商户名称A', 123, 34212],
          [2, '商户名称B', 123, 34212],
          [3, '商户名称C', 123, 34212],
        ],
      },
    },
    {
      id: 'interest',
      kind: 'line',
      title: '利息支出',
      rect: { x: 48, y: 734, width: 420, height: 270 },
      data: {
        xKey: 'label',
        rows: months.map((label, index) => ({
          label,
          fixed: [330, 285, 350, 250, 225, 345][index],
          current: [680, 520, 690, 605, 420, 810][index],
        })),
        series: [
          { key: 'fixed', label: '定期', color: '#c6a36c' },
          { key: 'current', label: '活期', color: '#d7192d' },
        ],
      },
    },
    {
      id: 'products',
      kind: 'table',
      title: '明星理财产品',
      rect: { x: 488, y: 734, width: 420, height: 270 },
      data: {
        scroll: true,
        columns: ['排行', '名称', '编号', '热度值'],
        rows: [
          [8, '商户名称H', '09221', 4],
          [9, '商户名称I', '01223', 3],
          [10, '商户名称J', '09432', 2],
          [1, '商户名称A', '12556', 5],
        ],
      },
    },
    {
      id: 'channels',
      kind: 'donut',
      title: '各渠道交易数占比',
      rect: { x: 928, y: 734, width: 420, height: 270 },
      data: {
        items: [
          ['网上银行', 18],
          ['手机银行', 42],
          ['微信银行', 22],
          ['电话银行', 11],
          ['第三方支付', 7],
        ],
      },
    },
    {
      id: 'competitiveness',
      kind: 'cluster',
      title: '核心竞争力',
      rect: { x: 1368, y: 734, width: 504, height: 270 },
      data: { items: ['网点优势', '客户基础', '创新驱动', '管理架构', '发展环境', '一体化', '快速有效'] },
    },
  ],
})

/** @deprecated Use bankFinancialSceneDemoSpec for benchmark/demo data. Runtime defaults are localized. */
export const defaultBankFinancialSceneSpec = bankFinancialSceneDemoSpec
