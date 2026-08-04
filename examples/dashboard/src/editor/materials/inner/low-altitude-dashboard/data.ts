export type LowAltitudeTone = 'cyan' | 'green' | 'amber' | 'red'

export interface LowAltitudeKpi {
  label: string
  value: string | number
  unit?: string
  trend?: string
  tone?: LowAltitudeTone
}

export interface LowAltitudeValueItem {
  label: string
  value: number
  unit?: string
}

export interface LowAltitudeAlert {
  time: string
  level: string
  text: string
}

export interface LowAltitudeRoute {
  from: string
  to: string
  status?: string
}

export interface LowAltitudeFleetItem {
  label: string
  value: string | number
  tone?: LowAltitudeTone
}

export interface LowAltitudeTask {
  id: string
  type: string
  route: string
  status: string
}

export interface LowAltitudeDashboardData {
  kpis: LowAltitudeKpi[]
  flightTrend: LowAltitudeValueItem[]
  taskMix: LowAltitudeValueItem[]
  alerts: LowAltitudeAlert[]
  routes: LowAltitudeRoute[]
  fleet: LowAltitudeFleetItem[]
  tasks: LowAltitudeTask[]
}

export const defaultLowAltitudeDashboardData: LowAltitudeDashboardData = {
  kpis: [
    { label: '今日飞行', value: 286, unit: '架次', trend: '较昨日 +12.6%', tone: 'cyan' },
    { label: '在线飞行器', value: 42, unit: '架', trend: '适航率 97.8%', tone: 'green' },
    { label: '开放航线', value: 18, unit: '条', trend: '繁忙航线 6 条', tone: 'cyan' },
    { label: '告警事件', value: 3, unit: '起', trend: '1 起待处置', tone: 'amber' },
  ],
  flightTrend: [
    { label: '07/22', value: 198 },
    { label: '07/23', value: 224 },
    { label: '07/24', value: 215 },
    { label: '07/25', value: 259 },
    { label: '07/26', value: 243 },
    { label: '07/27', value: 272 },
    { label: '今日', value: 286 },
  ],
  taskMix: [
    { label: '巡检', value: 36, unit: '项' },
    { label: '物流', value: 28, unit: '项' },
    { label: '应急', value: 14, unit: '项' },
    { label: '文旅', value: 22, unit: '项' },
  ],
  alerts: [
    { time: '10:42:18', level: '紧急', text: '湔江航段突发阵风，已调整飞行高度' },
    { time: '10:31:05', level: '关注', text: '丹景山巡检区通信信号短时波动' },
    { time: '09:58:44', level: '提示', text: '濛阳物流枢纽进入早间任务高峰' },
  ],
  routes: [
    { from: '桂花机场', to: '濛阳物流枢纽', status: '通畅' },
    { from: '桂花机场', to: '丹景山巡检区', status: '通畅' },
    { from: '丹景山巡检区', to: '湔江文旅航线', status: '关注' },
    { from: '濛阳物流枢纽', to: '湔江文旅航线', status: '通畅' },
  ],
  fleet: [
    { label: '执行中', value: 18, tone: 'green' },
    { label: '待命', value: 15, tone: 'cyan' },
    { label: '充电', value: 6, tone: 'amber' },
    { label: '维护', value: 3, tone: 'red' },
  ],
  tasks: [
    { id: 'PZ-0728-042', type: '电力巡检', route: '桂花机场 → 丹景山', status: '执行中' },
    { id: 'PZ-0728-041', type: '即时物流', route: '濛阳枢纽 → 湔江站', status: '执行中' },
    { id: 'PZ-0728-040', type: '河道巡查', route: '湔江东段 → 西段', status: '待起飞' },
    { id: 'PZ-0728-039', type: '文旅航拍', route: '丹景山 → 龙门山', status: '已完成' },
  ],
}

const MAX_TEXT_LENGTH = 256

const SECTION_LIMITS = {
  kpis: 4,
  flightTrend: 7,
  taskMix: 4,
  alerts: 3,
  routes: 6,
  fleet: 4,
  tasks: 4,
} as const

const TONES = new Set<LowAltitudeTone>(['cyan', 'green', 'amber', 'red'])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const safeString = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_TEXT_LENGTH ? value : fallback

const safeOptionalString = (value: unknown, fallback?: string): string | undefined =>
  typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_TEXT_LENGTH ? value : fallback

const safeFiniteNumber = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const safeDisplayValue = (value: unknown, fallback: string | number): string | number => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback
  return typeof value === 'string' && value.trim().length > 0 && value.length <= MAX_TEXT_LENGTH ? value : fallback
}

const safeTone = (value: unknown, fallback?: LowAltitudeTone): LowAltitudeTone | undefined =>
  typeof value === 'string' && TONES.has(value as LowAltitudeTone) ? (value as LowAltitudeTone) : fallback

const normalizeSection = <T>(
  value: unknown,
  fallback: T[],
  limit: number,
  normalizeItem: (value: unknown, fallback: T) => T,
): T[] => {
  if (!Array.isArray(value)) return fallback
  return value.slice(0, limit).map((item, index) => {
    const fallbackItem = fallback[Math.min(index, fallback.length - 1)]
    return normalizeItem(item, fallbackItem)
  })
}

const normalizeKpi = (value: unknown, fallback: LowAltitudeKpi): LowAltitudeKpi => {
  if (!isRecord(value)) return fallback
  return {
    label: safeString(value.label, fallback.label),
    value: safeDisplayValue(value.value, fallback.value),
    unit: safeOptionalString(value.unit, fallback.unit),
    trend: safeOptionalString(value.trend, fallback.trend),
    tone: safeTone(value.tone, fallback.tone),
  }
}

const normalizeValueItem = (value: unknown, fallback: LowAltitudeValueItem): LowAltitudeValueItem => {
  if (!isRecord(value)) return fallback
  return {
    label: safeString(value.label, fallback.label),
    value: safeFiniteNumber(value.value, fallback.value),
    unit: safeOptionalString(value.unit, fallback.unit),
  }
}

const normalizeAlert = (value: unknown, fallback: LowAltitudeAlert): LowAltitudeAlert => {
  if (!isRecord(value)) return fallback
  return {
    time: safeString(value.time, fallback.time),
    level: safeString(value.level, fallback.level),
    text: safeString(value.text, fallback.text),
  }
}

const normalizeRoute = (value: unknown, fallback: LowAltitudeRoute): LowAltitudeRoute => {
  if (!isRecord(value)) return fallback
  return {
    from: safeString(value.from, fallback.from),
    to: safeString(value.to, fallback.to),
    status: safeOptionalString(value.status, fallback.status),
  }
}

const normalizeFleetItem = (value: unknown, fallback: LowAltitudeFleetItem): LowAltitudeFleetItem => {
  if (!isRecord(value)) return fallback
  return {
    label: safeString(value.label, fallback.label),
    value: safeDisplayValue(value.value, fallback.value),
    tone: safeTone(value.tone, fallback.tone),
  }
}

const normalizeTask = (value: unknown, fallback: LowAltitudeTask): LowAltitudeTask => {
  if (!isRecord(value)) return fallback
  return {
    id: safeString(value.id, fallback.id),
    type: safeString(value.type, fallback.type),
    route: safeString(value.route, fallback.route),
    status: safeString(value.status, fallback.status),
  }
}

export const resolveLowAltitudeDashboardData = (value: unknown): LowAltitudeDashboardData => {
  if (!isRecord(value)) return defaultLowAltitudeDashboardData
  try {
    return {
      kpis: normalizeSection(value.kpis, defaultLowAltitudeDashboardData.kpis, SECTION_LIMITS.kpis, normalizeKpi),
      flightTrend: normalizeSection(
        value.flightTrend,
        defaultLowAltitudeDashboardData.flightTrend,
        SECTION_LIMITS.flightTrend,
        normalizeValueItem,
      ),
      taskMix: normalizeSection(
        value.taskMix,
        defaultLowAltitudeDashboardData.taskMix,
        SECTION_LIMITS.taskMix,
        normalizeValueItem,
      ),
      alerts: normalizeSection(
        value.alerts,
        defaultLowAltitudeDashboardData.alerts,
        SECTION_LIMITS.alerts,
        normalizeAlert,
      ),
      routes: normalizeSection(
        value.routes,
        defaultLowAltitudeDashboardData.routes,
        SECTION_LIMITS.routes,
        normalizeRoute,
      ),
      fleet: normalizeSection(
        value.fleet,
        defaultLowAltitudeDashboardData.fleet,
        SECTION_LIMITS.fleet,
        normalizeFleetItem,
      ),
      tasks: normalizeSection(value.tasks, defaultLowAltitudeDashboardData.tasks, SECTION_LIMITS.tasks, normalizeTask),
    }
  } catch {
    return defaultLowAltitudeDashboardData
  }
}
