import { Crown } from 'lucide-react'
import { type CSSProperties, type Ref, useEffect, useMemo, useState } from 'react'
import {
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import chinaProvincesMapRaw from './china-provinces.geo.json?raw'
import {
  type DashboardSceneGeoJsonFeatureCollection,
  type DashboardSceneRect,
  type DashboardSceneSpec,
  applyDashboardScenePrimaryWidgetData,
  defaultLocalizedDashboardSceneSpec,
  normalizeDashboardSceneSpec,
  resolveDashboardSceneComboMapData,
} from './spec'
import './component.css'

interface DashboardSceneProps {
  ref?: Ref<HTMLDivElement>
  spec?: unknown
  widgetData?: unknown
}

type DataRecord = Record<string, unknown>

const isRecord = (value: unknown): value is DataRecord =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const array = (value: unknown) => (Array.isArray(value) ? value : [])
const number = (value: unknown, fallback = 0) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback
const boundedNumber = (value: unknown, fallback: number, minimum: number, maximum: number) =>
  Math.min(maximum, Math.max(minimum, number(value, fallback)))
const string = (value: unknown, fallback = '') => (typeof value === 'string' ? value : fallback)
const record = (value: unknown): DataRecord => (isRecord(value) ? value : {})
const color = (value: unknown, fallback = '') => {
  const candidate = string(value).trim()
  return candidate && !/url\s*\(|javascript:|data:/iu.test(candidate) ? candidate : fallback
}
const numberFromText = (value: unknown, fallback = 0) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value !== 'string') return fallback
  const parsed = Number.parseFloat(value.replace(/[^\d.+-]/gu, ''))
  return Number.isFinite(parsed) ? parsed : fallback
}
const defaultChinaProvincesMap = normalizeDashboardSceneSpec({ map: JSON.parse(chinaProvincesMapRaw) }).map

const formatNumber = (value: number) =>
  new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 2, minimumFractionDigits: value % 1 ? 2 : 0 }).format(value)

const panelStyle = (rect: DashboardSceneRect): CSSProperties => ({
  height: rect.height,
  left: rect.x,
  top: rect.y,
  width: rect.width,
})

const Clock = () => {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <div className='dashboard-scene-clock' aria-label='实时日期与时间' data-dashboard-scene-clock={now.getTime()}>
      <span>{now.toLocaleDateString('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' })}</span>
      <strong>{now.toLocaleTimeString('zh-CN', { hour12: false })}</strong>
    </div>
  )
}

const WidgetHeading = ({ title }: { title: string }) => (
  <div className='dashboard-scene-widget-heading'>
    <span className='dashboard-scene-heading-mark' />
    <h2>{title}</h2>
  </div>
)

const ratingValue = (value: unknown) =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 5 ? value : null
const topRankValue = (value: unknown) => {
  const rank = ratingValue(value)
  return rank && rank <= 3 ? rank : null
}
const ratingStars = ['star-1', 'star-2', 'star-3', 'star-4', 'star-5']

const KpiWidget = ({ data }: { data: DataRecord }) => {
  const trendSource = Array.isArray(data.trend) ? data.trend : data.points
  const trend = array(trendSource).map(value => number(value))
  const chartData = trend.map((value, index) => ({ index, value }))
  const change = numberFromText(data.change ?? data.trend)
  const emphasized = data.emphasized === true || data.emphasis === true
  return (
    <div className={`dashboard-scene-kpi ${emphasized ? 'is-emphasized' : ''}`}>
      <div className='dashboard-scene-kpi-main'>
        <strong>{formatNumber(number(data.value))}</strong>
        <span>{string(data.unit)}</span>
      </div>
      <div className='dashboard-scene-kpi-change'>
        <span>同比</span>
        <b className={change < 0 ? 'is-negative' : 'is-positive'}>
          {change >= 0 ? '↑' : '↓'} {Math.abs(change).toFixed(2)}%
        </b>
      </div>
      <div className='dashboard-scene-kpi-chart'>
        <ResponsiveContainer width='100%' height='100%'>
          <LineChart data={chartData}>
            <Line
              type='natural'
              dataKey='value'
              stroke={change < 0 ? 'var(--ds-negative)' : emphasized ? '#f8fafc' : 'var(--ds-accent)'}
              strokeWidth={2.4}
              dot={false}
              isAnimationActive
              animationDuration={1100}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

const TableWidget = ({ data }: { data: DataRecord }) => {
  const columns = array(data.columns)
    .flatMap((value, index) => {
      if (typeof value === 'string') return [{ key: `column-${index}`, label: value }]
      if (!isRecord(value)) return []
      const key = string(value.key, `column-${index}`)
      return [{ key, label: string(value.label, key) }]
    })
    .slice(0, 8)
  const rows = array(data.rows)
    .flatMap(row => {
      if (Array.isArray(row)) return [row.slice(0, columns.length || 8)]
      if (!isRecord(row)) return []
      return [columns.map(column => row[column.key])]
    })
    .slice(0, 32)
  const scrolling = (data.scroll === true || data.autoScroll === true) && rows.length > 3
  const rankIcons = data.rankIcons === true
  const scrollSeconds = Math.min(60, Math.max(6, number(data.scrollSeconds, 12)))
  const tableStyle = {
    '--ds-header-height': `${boundedNumber(data.headerHeight, 42, 34, 50)}px`,
    '--ds-row-height': `${boundedNumber(data.rowHeight, 46, 36, 56)}px`,
    '--ds-scroll-duration': `${scrollSeconds}s`,
    '--ds-table-font-size': `${boundedNumber(data.fontSize, 13, 12, 18)}px`,
  } as CSSProperties
  const visibleRows = scrolling ? [...rows, ...rows] : rows
  return (
    <div className='dashboard-scene-table' style={tableStyle}>
      <div
        className='dashboard-scene-table-row is-head'
        style={{ gridTemplateColumns: `repeat(${Math.max(columns.length, 1)}, 1fr)` }}
      >
        {columns.map(column => (
          <span key={column.key}>{column.label}</span>
        ))}
      </div>
      <div
        className={`dashboard-scene-table-body ${scrolling ? 'is-scrolling' : ''}`}
        data-dashboard-scene-scroll={scrolling ? 'active' : 'inactive'}
      >
        <div className='dashboard-scene-table-track'>
          {visibleRows.map((row, rowIndex) => (
            <div
              className={`dashboard-scene-table-row ${topRankValue(row[0]) ? `is-top-rank-${row[0]}` : ''}`}
              style={{ gridTemplateColumns: `repeat(${Math.max(columns.length, 1)}, 1fr)` }}
              key={`${rowIndex}-${row.map(cell => String(cell)).join('-')}`}
            >
              {row.map((cell, cellIndex) => {
                const rating = cellIndex === row.length - 1 ? ratingValue(cell) : null
                const topRank = cellIndex === 0 && rankIcons ? topRankValue(cell) : null
                if (topRank) {
                  return (
                    <span
                      className={`dashboard-scene-table-rank is-rank-${topRank}`}
                      aria-label={`第 ${topRank} 名`}
                      key={`${cellIndex}-${String(cell)}`}
                    >
                      <Crown aria-hidden='true' />
                      <b>{topRank}</b>
                    </span>
                  )
                }
                if (rating) {
                  return (
                    <span
                      className='dashboard-scene-rating'
                      aria-label={`${rating} 星`}
                      key={`${cellIndex}-${String(cell)}`}
                    >
                      {ratingStars.map((star, starIndex) => (
                        <i className={starIndex < rating ? 'is-active' : ''} key={star} />
                      ))}
                    </span>
                  )
                }
                return <span key={`${cellIndex}-${String(cell)}`}>{String(cell)}</span>
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const RankWidget = ({ data }: { data: DataRecord }) => {
  const items = array(data.items)
    .flatMap(item => {
      if (Array.isArray(item)) return [[string(item[0]), number(item[1])] as const]
      if (!isRecord(item)) return []
      return [[string(item.label, string(item.name)), number(item.value)] as const]
    })
    .filter(item => item[0])
    .slice(0, 12)
  const max = Math.max(1, ...items.map(item => item[1]))
  const unit = string(data.unit, '%')
  return (
    <div className='dashboard-scene-rank'>
      {items.map(([label, value], index) => (
        <div className='dashboard-scene-rank-row' key={label}>
          <div className='dashboard-scene-rank-meta'>
            <span>
              <b>{index + 1}</b>
              {label}
            </span>
            <strong>
              {value}
              {unit}
            </strong>
          </div>
          <div className='dashboard-scene-rank-bar'>
            <span style={{ width: `${(value / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  )
}

const chartRows = (data: DataRecord) => array(data.rows).filter(isRecord)
const chartSeries = (data: DataRecord) => array(data.series).filter(isRecord).slice(0, 6)
const valuesFromSeries = (value: unknown) => {
  const list = array(value)
  if (list.every(item => typeof item === 'number')) return list.map(item => number(item))
  const first = record(list[0])
  return array(first.values).map(item => number(item))
}
const featurePolygons = (feature: DashboardSceneGeoJsonFeatureCollection['features'][number]): number[][][][] =>
  feature.geometry.type === 'Polygon'
    ? [feature.geometry.coordinates as number[][][]]
    : (feature.geometry.coordinates as number[][][][])

const LineWidget = ({ data }: { data: DataRecord }) => {
  const sourceRows = chartRows(data)
  const sourceSeries = chartSeries(data)
  const categories = array(data.categories)
  const xKey = sourceRows.length ? string(data.xKey, 'label') : 'label'
  const series = sourceSeries.map((item, index) => ({
    key: sourceRows.length ? string(item.key, `series-${index}`) : `series-${index}`,
    label: string(item.label, string(item.name, `序列 ${index + 1}`)),
    color: string(item.color, `var(--ds-chart-${index + 1})`),
    values: array(item.values).map(value => number(value)),
  }))
  const rows = sourceRows.length
    ? sourceRows
    : categories.map((category, categoryIndex) =>
        Object.fromEntries([
          ['label', string(category, String(category))],
          ...series.map(item => [item.key, item.values[categoryIndex] ?? 0]),
        ]),
      )
  const yDomain =
    Array.isArray(data.yDomain) &&
    data.yDomain.length === 2 &&
    data.yDomain.every(value => typeof value === 'number' && Number.isFinite(value))
      ? ([data.yDomain[0], data.yDomain[1]] as [number, number])
      : undefined
  const yTicks = array(data.yTicks)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    .slice(0, 24)
  const showLegend = data.showLegend === true
  const showYAxis = data.showYAxis !== false
  const showAllXTicks = data.showAllXTicks === true
  const horizontalGrid = data.horizontalGrid !== false
  const verticalGrid = data.verticalGrid === true
  const dotRadius = boundedNumber(data.dotRadius, 3, 0, 12)
  const animate = data.animate !== false
  return (
    <div
      className='dashboard-scene-chart'
      data-dashboard-scene-chart='line'
      data-dashboard-scene-animate={animate ? 'active' : 'inactive'}
    >
      {showLegend ? (
        <div className='dashboard-scene-line-legend' aria-label='图例'>
          {series.map(item => (
            <span key={item.key}>
              <i style={{ background: item.color }} />
              {item.label}
            </span>
          ))}
        </div>
      ) : null}
      <div className='dashboard-scene-line-plot'>
        <ResponsiveContainer width='100%' height='100%'>
          <LineChart data={rows} margin={{ top: 12, right: 12, bottom: 0, left: -14 }}>
            <CartesianGrid
              horizontal={horizontalGrid}
              stroke='var(--ds-grid)'
              strokeDasharray='3 3'
              vertical={verticalGrid}
            />
            <XAxis
              dataKey={xKey}
              axisLine={false}
              interval={showAllXTicks ? 0 : undefined}
              tickLine={false}
              tick={{ fill: 'var(--ds-muted)', fontSize: 12 }}
            />
            {showYAxis ? (
              <YAxis
                axisLine={false}
                domain={yDomain}
                interval={yTicks.length ? 0 : undefined}
                tickLine={false}
                ticks={yTicks.length ? yTicks : undefined}
                tick={{ fill: 'var(--ds-muted)', fontSize: 12 }}
              />
            ) : null}
            <Tooltip />
            {series.map((item, index) => (
              <Line
                key={item.key}
                dataKey={item.key}
                name={item.label}
                stroke={item.color}
                type='natural'
                strokeWidth={2.6}
                dot={{ r: dotRadius }}
                isAnimationActive={animate}
                animationDuration={1200 + index * 140}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

const MapView = ({ map, data }: { map?: DashboardSceneGeoJsonFeatureCollection; data: DataRecord }) => {
  const projection = useMemo(() => {
    if (!map) return null
    const points = map.features.flatMap(feature => {
      const polygons = featurePolygons(feature)
      return polygons.flatMap(polygonValue => polygonValue.flat())
    })
    if (!points.length) return null
    const longitudes = points.map(point => point[0])
    const latitudes = points.map(point => point[1])
    const minX = Math.min(...longitudes)
    const maxX = Math.max(...longitudes)
    const minY = Math.min(...latitudes)
    const maxY = Math.max(...latitudes)
    const scaleX = 400 / Math.max(maxX - minX, 1)
    const scaleY = 270 / Math.max(maxY - minY, 1)
    const scale = Math.min(scaleX, scaleY)
    const project = (point: number[]) => [20 + (point[0] - minX) * scale, 290 - (point[1] - minY) * scale]
    const pathForPolygon = (polygonValue: number[][][]) =>
      polygonValue
        .map(ring => `${ring.map((point, index) => `${index ? 'L' : 'M'}${project(point).join(' ')}`).join('')}Z`)
        .join('')
    return map.features.map(feature => {
      const polygons = featurePolygons(feature)
      return { name: feature.properties.name, path: polygons.map(pathForPolygon).join('') }
    })
  }, [map])
  const regionStyles = new Map<string, { emphasis: boolean; fill: string; label: string }>()
  for (const value of [...array(data.regions), ...array(data.highlights)]) {
    if (typeof value === 'string') {
      if (value) regionStyles.set(value, { emphasis: true, fill: '', label: value })
      continue
    }
    if (!isRecord(value)) continue
    const name = string(value.name, string(value.label))
    if (!name) continue
    regionStyles.set(name, {
      emphasis: value.emphasis !== false,
      fill: color(value.fill, color(value.color)),
      label: string(value.label, name),
    })
  }
  const mapScale = boundedNumber(data.mapScale, 1, 1, 1.25)

  if (!projection) return <div className='dashboard-scene-map-empty'>{string(data.emptyMapText, '暂无地图数据')}</div>
  return (
    <svg
      className='dashboard-scene-map-svg'
      viewBox='0 0 440 310'
      role='img'
      aria-label='GeoJSON 区域地图'
      style={{ transform: `scale(${mapScale})` }}
    >
      {projection.map(feature => {
        const region = regionStyles.get(feature.name)
        return (
          <path
            className={region?.emphasis ? 'is-highlighted' : ''}
            d={feature.path}
            key={feature.name}
            style={region?.fill ? { fill: region.fill } : undefined}
          >
            <title>{region?.label || feature.name}</title>
          </path>
        )
      })}
    </svg>
  )
}

const compactItems = (value: unknown) =>
  array(value)
    .flatMap((item, index) => {
      if (typeof item === 'string') return [{ key: item, label: item, value: '', color: '' }]
      if (!isRecord(item)) return []
      const label = string(item.label, string(item.name, string(item.value)))
      if (!label) return []
      return [
        {
          key: string(item.value, string(item.name, label || `item-${index}`)),
          label,
          value: typeof item.value === 'number' ? formatNumber(item.value) : string(item.detail),
          color: color(item.fill, color(item.color)),
        },
      ]
    })
    .slice(0, 12)

const CompactTabs = ({
  items,
  active,
  className,
  label,
  onChange,
}: {
  items: ReturnType<typeof compactItems>
  active: string
  className: string
  label: string
  onChange: (key: string) => void
}) =>
  items.length ? (
    <ul className={className} aria-label={label}>
      {items.map((item, index) => (
        <li className={active === item.key || active === item.label ? 'is-active' : ''} key={`${item.key}-${index}`}>
          <button
            type='button'
            aria-pressed={active === item.key || active === item.label}
            onClick={() => onChange(item.key)}
          >
            {item.label}
          </button>
        </li>
      ))}
    </ul>
  ) : null

const CompactLegend = ({ items }: { items: ReturnType<typeof compactItems> }) =>
  items.length ? (
    <div className='dashboard-scene-combo-legend' aria-label='图例'>
      {items.map((item, index) => (
        <span key={`${item.key}-${index}`}>
          <i style={{ background: item.color || `var(--ds-chart-${(index % 3) + 1})` }} />
          {item.label}
          {item.value ? <b>{item.value}</b> : null}
        </span>
      ))}
    </div>
  ) : null

const selectedItemKey = (items: ReturnType<typeof compactItems>, configured: unknown) => {
  const preferred = string(configured)
  return items.find(item => item.key === preferred || item.label === preferred)?.key ?? items[0]?.key ?? ''
}

const ComboMapWidget = ({ data, map }: { data: DataRecord; map?: DashboardSceneGeoJsonFeatureCollection }) => {
  const tabs = useMemo(() => compactItems(data.tabs), [data.tabs])
  const provinceTabs = useMemo(() => compactItems(data.provinceTabs), [data.provinceTabs])
  const [selectedTab, setSelectedTab] = useState(() => selectedItemKey(tabs, data.activeTab))
  const [selectedProvince, setSelectedProvince] = useState(() => selectedItemKey(provinceTabs, data.selectedProvince))

  useEffect(() => {
    setSelectedTab(selectedItemKey(tabs, data.activeTab))
  }, [data.activeTab, tabs])

  useEffect(() => {
    setSelectedProvince(selectedItemKey(provinceTabs, data.selectedProvince))
  }, [data.selectedProvince, provinceTabs])

  const selectedTabItem = tabs.find(item => item.key === selectedTab)
  const selectedProvinceItem = provinceTabs.find(item => item.key === selectedProvince)
  const activeData = resolveDashboardSceneComboMapData(data, {
    tabKey: selectedTab,
    tabLabel: selectedTabItem?.label,
    provinceKey: selectedProvince,
    provinceLabel: selectedProvinceItem?.label,
  })
  const sourceRows = array(activeData.chart).filter(isRecord)
  const categories = array(activeData.categories)
  const barValues = valuesFromSeries(activeData.bars)
  const lineValues = valuesFromSeries(activeData.lines)
  const rows = sourceRows.length
    ? sourceRows
    : categories.map((category, index) => ({
        label: string(category, String(category)),
        profit: barValues[index] ?? 0,
        revenue: lineValues[index] ?? 0,
      }))
  const animate = activeData.animate !== false
  const legend = compactItems(activeData.legend)
  const mapWidthPercent = boundedNumber(activeData.mapWidthPercent, 55, 45, 68)
  const chartYDomain =
    Array.isArray(activeData.chartYDomain) &&
    activeData.chartYDomain.length === 2 &&
    activeData.chartYDomain.every(value => typeof value === 'number' && Number.isFinite(value))
      ? ([activeData.chartYDomain[0], activeData.chartYDomain[1]] as [number, number])
      : undefined
  const chartYTicks = array(activeData.chartYTicks)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    .slice(0, 12)
  return (
    <div
      className='dashboard-scene-combo'
      data-dashboard-scene-chart='combo-map'
      data-dashboard-scene-animate={animate ? 'active' : 'inactive'}
      data-dashboard-scene-active-tab={selectedTab}
      data-dashboard-scene-selected-province={selectedProvince}
    >
      <div
        className='dashboard-scene-combo-content'
        style={{ '--ds-combo-map-width': `${mapWidthPercent}%` } as CSSProperties}
      >
        <div className='dashboard-scene-map-panel'>
          <MapView map={map} data={activeData} />
          <CompactTabs
            items={provinceTabs}
            active={selectedProvince}
            className='dashboard-scene-province-tabs'
            label='省份筛选'
            onChange={setSelectedProvince}
          />
        </div>
        <div className='dashboard-scene-combo-chart-panel'>
          <CompactTabs
            items={tabs}
            active={selectedTab}
            className='dashboard-scene-combo-tabs'
            label='指标筛选'
            onChange={setSelectedTab}
          />
          <CompactLegend items={legend} />
          <div className='dashboard-scene-combo-chart'>
            <ResponsiveContainer width='100%' height='100%'>
              <ComposedChart
                data={rows}
                key={`${selectedTab}:${selectedProvince}`}
                margin={{ top: 8, right: 8, bottom: 0, left: -16 }}
              >
                <CartesianGrid stroke='var(--ds-grid)' strokeDasharray='3 3' vertical={false} />
                <XAxis
                  dataKey='label'
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: 'var(--ds-muted)', fontSize: 11 }}
                />
                <YAxis
                  axisLine={false}
                  domain={chartYDomain}
                  interval={chartYTicks.length ? 0 : undefined}
                  tickLine={false}
                  ticks={chartYTicks.length ? chartYTicks : undefined}
                  tick={{ fill: 'var(--ds-muted)', fontSize: 11 }}
                />
                <Tooltip />
                <Bar
                  dataKey='profit'
                  fill='var(--ds-accent)'
                  radius={[3, 3, 0, 0]}
                  isAnimationActive={animate}
                  animationDuration={1000}
                />
                <Line
                  dataKey='revenue'
                  stroke='var(--ds-negative)'
                  strokeWidth={2.5}
                  type='natural'
                  dot={{ r: 3 }}
                  isAnimationActive={animate}
                  animationDuration={1400}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  )
}

const donutItems = (value: unknown) =>
  array(value)
    .flatMap(item => {
      if (Array.isArray(item)) return [{ name: string(item[0]), value: number(item[1]), color: color(item[2]) }]
      if (!isRecord(item)) return []
      return [{ name: string(item.label, string(item.name)), value: number(item.value), color: color(item.color) }]
    })
    .filter(item => item.name)
    .slice(0, 10)

const DonutWidget = ({ data }: { data: DataRecord }) => {
  const colors = ['#d7192d', '#aeb6c5', '#eadfc8', '#c6a36c', '#7f8998']
  const sourceItems = array(data.items).length ? array(data.items) : array(data.segments)
  const ringRecords = array(data.rings).filter(isRecord).slice(0, 2)
  const configuredRings = ringRecords
    .map((ring, index) => {
      const defaultInnerRadius = index === 0 ? 62 : 34
      const defaultOuterRadius = index === 0 ? 88 : 56
      const innerRadius = boundedNumber(ring.innerRadius, defaultInnerRadius, 5, 88)
      return {
        items: donutItems(ring.items),
        innerRadius,
        outerRadius: boundedNumber(ring.outerRadius, defaultOuterRadius, innerRadius + 4, 96),
      }
    })
    .filter(ring => ring.items.length)
  const rings = configuredRings.length
    ? configuredRings
    : [{ items: donutItems(sourceItems), innerRadius: 53, outerRadius: 86 }]
  const legendItems = array(data.legendItems).length ? donutItems(data.legendItems) : rings[0].items
  const chartWidthPercent = boundedNumber(data.chartWidthPercent, 66, 45, 85)
  const donutStyle = {
    '--ds-donut-legend-font-size': `${boundedNumber(data.legendFontSize, 12, 10, 18)}px`,
  } as CSSProperties
  const animate = data.animate !== false
  return (
    <div
      className='dashboard-scene-donut'
      data-dashboard-scene-chart='donut'
      data-dashboard-scene-animate={animate ? 'active' : 'inactive'}
      style={donutStyle}
    >
      <ResponsiveContainer width={`${chartWidthPercent}%`} height='100%'>
        <PieChart>
          <Tooltip />
          {rings.map((ring, ringIndex) => (
            <Pie
              data={ring.items}
              dataKey='value'
              nameKey='name'
              innerRadius={`${ring.innerRadius}%`}
              outerRadius={`${ring.outerRadius}%`}
              paddingAngle={2}
              isAnimationActive={animate}
              animationDuration={1300 + ringIndex * 180}
              key={`${ring.innerRadius}-${ring.outerRadius}-${ring.items.map(item => item.name).join('-')}`}
            >
              {ring.items.map((item, index) => (
                <Cell
                  key={`${item.name}-${index}`}
                  fill={item.color || colors[(index + ringIndex * 2) % colors.length]}
                />
              ))}
            </Pie>
          ))}
        </PieChart>
      </ResponsiveContainer>
      <div className='dashboard-scene-donut-legend'>
        {legendItems.map((item, index) => (
          <span key={`${item.name}-${index}`}>
            <i style={{ background: item.color || colors[index % colors.length] }} />
            {item.name}
            <b>{item.value}%</b>
          </span>
        ))}
      </div>
    </div>
  )
}

const ClusterWidget = ({ data }: { data: DataRecord }) => {
  const sourceItems = array(data.items)
    .flatMap((value, index) => {
      const input = isRecord(value) ? value : {}
      const label = isRecord(value) ? string(input.label, string(input.name)) : string(value)
      if (!label) return []
      return [{ id: string(input.id, label || `cluster-item-${index}`), input, label }]
    })
    .slice(0, 7)
  const centerItem = string(data.centerItem)
  const centerIndex = sourceItems.findIndex(item => item.id === centerItem || item.label === centerItem)
  const items =
    centerIndex >= 0
      ? [sourceItems[centerIndex], ...sourceItems.filter((_, index) => index !== centerIndex)]
      : sourceItems
  const positions = [
    [48, 52],
    [17, 28],
    [43, 19],
    [75, 27],
    [20, 75],
    [55, 81],
    [84, 70],
  ]
  const defaultColors = ['var(--ds-accent)', '#9ba5b4', '#a8afba', '#7f8998', '#c6a36c', '#8f99a8', '#c6a36c']
  const floating = data.motion !== 'none' && data.animate !== false
  return (
    <div className='dashboard-scene-cluster' data-dashboard-scene-cluster-motion={floating ? 'float' : 'none'}>
      {items.map((item, index) => {
        const [defaultX, defaultY] = positions[index]
        const isCenter = index === 0
        const x = boundedNumber(item.input.x, defaultX, 4, 96)
        const y = boundedNumber(item.input.y, defaultY, 4, 96)
        const size = boundedNumber(item.input.size, isCenter ? 80 : 66, 48, 104)
        const scale = boundedNumber(item.input.scale, 1, 0.7, 1.45)
        const baseRotation = boundedNumber(item.input.rotation, 45, 20, 70)
        const itemColor = color(item.input.color, defaultColors[index])
        const configuredLayers: DataRecord[] = array(item.input.layers)
          .filter(isRecord)
          .slice(0, 3)
          .map((layer, layerIndex) => ({
            ...layer,
            id: string(layer.id, `layer-${layerIndex + 1}`),
          }))
        const defaultLayers: DataRecord[] = [
          { id: 'primary', opacity: 0.88, rotation: baseRotation, scale: 1, offsetX: 0, offsetY: 0, blur: 0 },
          { id: 'halo', opacity: 0.2, rotation: baseRotation + 9, scale: 1.14, offsetX: 5, offsetY: 3, blur: 0 },
          { id: 'mist', opacity: 0.12, rotation: baseRotation - 8, scale: 1.22, offsetX: -4, offsetY: 5, blur: 1.2 },
        ]
        const layers = configuredLayers.length ? configuredLayers : defaultLayers
        const style = {
          '--ds-cluster-x': `${x}%`,
          '--ds-cluster-y': `${y}%`,
          '--ds-cluster-z': boundedNumber(item.input.zIndex, positions.length - Math.abs(3 - index), 0, 24),
          '--ds-cluster-node-frame-height': `${Math.round(size * 1.5)}px`,
          '--ds-cluster-node-frame-width': `${Math.round(size * 1.65)}px`,
          '--ds-cluster-node-scale': scale,
          '--ds-cluster-font-size': `${boundedNumber(item.input.fontSize, isCenter ? 15 : 13, 10, 22)}px`,
          '--ds-cluster-font-weight': boundedNumber(item.input.fontWeight, 650, 400, 850),
          animationDelay: `${index * -0.37}s`,
        } as CSSProperties
        return (
          <span
            className={`dashboard-scene-cluster-node ${isCenter ? 'is-center' : ''} ${floating ? '' : 'is-static'}`}
            style={style}
            key={`${item.id}-${index}`}
          >
            {layers.map((layer, layerIndex) => {
              const layerStyle = {
                '--ds-cluster-layer-blur': `${boundedNumber(layer.blur, 0, 0, 8)}px`,
                '--ds-cluster-layer-color': color(layer.color, itemColor),
                '--ds-cluster-layer-offset-x': `${boundedNumber(layer.offsetX, 0, -16, 16)}px`,
                '--ds-cluster-layer-offset-y': `${boundedNumber(layer.offsetY, 0, -16, 16)}px`,
                '--ds-cluster-layer-opacity': boundedNumber(layer.opacity, layerIndex === 0 ? 0.88 : 0.16, 0.04, 1),
                '--ds-cluster-layer-rotation': `${boundedNumber(layer.rotation, baseRotation, -90, 90)}deg`,
                '--ds-cluster-layer-scale': boundedNumber(layer.scale, 1 + layerIndex * 0.1, 0.72, 1.5),
                '--ds-cluster-layer-size': `${size}px`,
              } as CSSProperties
              return <i className='dashboard-scene-cluster-layer' style={layerStyle} key={string(layer.id)} />
            })}
            <b>{item.label}</b>
          </span>
        )
      })}
    </div>
  )
}

const WidgetBody = ({ kind, data, scene }: { kind: string; data: DataRecord; scene: DashboardSceneSpec }) => {
  if (kind === 'kpi') return <KpiWidget data={data} />
  if (kind === 'combo-map') return <ComboMapWidget data={data} map={scene.map ?? defaultChinaProvincesMap} />
  if (kind === 'table') return <TableWidget data={data} />
  if (kind === 'rank') return <RankWidget data={data} />
  if (kind === 'line') return <LineWidget data={data} />
  if (kind === 'donut') return <DonutWidget data={data} />
  return <ClusterWidget data={data} />
}

const DashboardScene = ({ ref, spec = defaultLocalizedDashboardSceneSpec, widgetData }: DashboardSceneProps) => {
  const scene = useMemo(
    () => applyDashboardScenePrimaryWidgetData(normalizeDashboardSceneSpec(spec), widgetData),
    [spec, widgetData],
  )
  const variables = {
    '--ds-background': scene.theme.background,
    '--ds-surface': scene.theme.surface,
    '--ds-surface-strong': scene.theme.surfaceStrong,
    '--ds-text': scene.theme.text,
    '--ds-muted': scene.theme.muted,
    '--ds-accent': scene.theme.accent,
    '--ds-negative': scene.theme.negative,
    '--ds-positive': scene.theme.positive,
    '--ds-grid': scene.theme.grid,
    '--ds-border': scene.theme.border,
  } as CSSProperties
  const canvasStyle = {
    height: scene.canvas.height,
    width: scene.canvas.width,
  } as CSSProperties

  return (
    <div ref={ref} className={`dashboard-scene ${scene.header.showHeader ? '' : 'is-header-hidden'}`} style={variables}>
      {scene.header.showHeader ? (
        <header className='dashboard-scene-header'>
          <div className='dashboard-scene-brand'>{scene.header.brand}</div>
          <div className='dashboard-scene-heading'>
            <h1>{scene.header.title}</h1>
            {scene.header.subtitle ? <span>{scene.header.subtitle}</span> : null}
          </div>
          {scene.header.showClock ? <Clock /> : null}
        </header>
      ) : null}
      <main className='dashboard-scene-canvas' style={canvasStyle}>
        {scene.widgets.map(widget => (
          <section
            className={`dashboard-scene-widget is-${widget.kind} ${widget.chrome === 'none' ? 'is-chrome-none' : ''}`}
            data-dashboard-scene-chrome={widget.chrome ?? 'default'}
            data-dashboard-scene-id={widget.id}
            data-dashboard-scene-kind={widget.kind}
            key={widget.id}
            style={panelStyle(widget.rect)}
          >
            <WidgetHeading title={widget.title} />
            <WidgetBody kind={widget.kind} data={record(widget.data)} scene={scene} />
          </section>
        ))}
      </main>
    </div>
  )
}

export default DashboardScene
