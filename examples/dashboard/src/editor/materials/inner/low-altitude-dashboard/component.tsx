import type { CSSProperties, Ref } from 'react'
import { type LowAltitudeTone, defaultLowAltitudeDashboardData, resolveLowAltitudeDashboardData } from './data'
import './component.css'

interface LowAltitudeDashboardProps {
  ref?: Ref<HTMLDivElement>
  heading?: string
  data?: unknown
}

const toneColor = (tone?: LowAltitudeTone) => {
  if (tone === 'green') return '#42e2a2'
  if (tone === 'amber') return '#ffbd57'
  if (tone === 'red') return '#ff6577'
  return '#43d8ff'
}

const alertTone = (level: string) => {
  if (/紧急|严重|高/u.test(level)) return '#ff6577'
  if (/关注|警告|中/u.test(level)) return '#ffbd57'
  return '#43d8ff'
}

const chartPoints = (values: readonly number[], width: number, height: number, padding = 18) => {
  if (!values.length) return ''
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const span = Math.max(max - min, 1)
  return values
    .map((value, index) => {
      const x = padding + (index / Math.max(values.length - 1, 1)) * (width - padding * 2)
      const y = height - padding - ((value - min) / span) * (height - padding * 2)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

const MAP_POINTS = [
  [150, 310],
  [355, 155],
  [600, 300],
  [465, 420],
  [730, 170],
  [250, 465],
] as const

const LowAltitudeDashboard = ({
  ref,
  heading = '彭州低空经济运行态势',
  data = defaultLowAltitudeDashboardData,
}: LowAltitudeDashboardProps) => {
  const resolved = resolveLowAltitudeDashboardData(data)
  const taskMax = Math.max(...resolved.taskMix.map(item => Number(item.value) || 0), 1)
  const locations = [...new Set(resolved.routes.flatMap(route => [route.from, route.to]))].slice(0, MAP_POINTS.length)
  const pointByName = new Map(locations.map((name, index) => [name, MAP_POINTS[index]]))
  const trendValues = resolved.flightTrend.map(item => Number(item.value) || 0)
  const trendPolyline = chartPoints(trendValues, 620, 142, 22)
  const trendPoints = trendPolyline.split(' ').filter(Boolean)

  return (
    <div ref={ref} className='low-altitude-dashboard'>
      <header className='lad-header'>
        <div className='lad-brand'>
          <span className='lad-brand-mark' />
          <span>PENGZHOU · LOW ALTITUDE</span>
        </div>
        <h1 className='lad-title'>{heading}</h1>
        <div className='lad-clock'>
          <span className='lad-live' />
          <span>空域运行正常</span>
          <span>10:48:26</span>
        </div>
      </header>

      <section className='lad-kpis'>
        {resolved.kpis.slice(0, 4).map((item, index) => (
          <article
            className='lad-kpi'
            key={`${item.label}-${index}`}
            style={{ '--tone': toneColor(item.tone) } as CSSProperties}
          >
            <div>
              <div className='lad-kpi-label'>{item.label}</div>
              <div className='lad-kpi-value'>
                {item.value}
                {item.unit ? <span className='lad-kpi-unit'>{item.unit}</span> : null}
              </div>
            </div>
            <div className='lad-kpi-trend'>{item.trend}</div>
          </article>
        ))}
      </section>

      <section className='lad-main'>
        <div className='lad-stack'>
          <article className='lad-panel'>
            <div className='lad-panel-title'>
              <h2>任务类型任务量</h2>
              <span className='lad-panel-code'>MISSION MIX</span>
            </div>
            <div className='lad-mix-list'>
              {resolved.taskMix.slice(0, 4).map(item => (
                <div className='lad-mix-row' key={item.label}>
                  <span>{item.label}</span>
                  <div className='lad-bar'>
                    <span style={{ width: `${Math.max(4, (Number(item.value) / taskMax) * 100)}%` }} />
                  </div>
                  <span className='lad-mix-value'>
                    {item.value}
                    {item.unit ?? '项'}
                  </span>
                </div>
              ))}
            </div>
          </article>

          <article className='lad-panel'>
            <div className='lad-panel-title'>
              <h2>机队实时状态</h2>
              <span className='lad-panel-code'>FLEET</span>
            </div>
            <div className='lad-fleet-grid'>
              {resolved.fleet.slice(0, 4).map(item => (
                <div
                  className='lad-fleet-item'
                  key={item.label}
                  style={{ '--tone': toneColor(item.tone) } as CSSProperties}
                >
                  <strong>{item.value}</strong>
                  <span>{item.label}</span>
                </div>
              ))}
            </div>
          </article>
        </div>

        <article className='lad-map'>
          <div className='lad-map-heading'>
            <span className='lad-section-kicker'>LOW ALTITUDE SITUATION</span>
            <strong>低空飞行态势</strong>
          </div>
          <span className='lad-map-status'>● 实时航迹接入</span>
          <svg className='lad-map-svg' viewBox='0 0 850 520' role='img' aria-label='彭州低空航路态势图'>
            <path
              className='lad-map-contour'
              d='M80 238L122 112l140-53 95 60 116-62 133 43 139 109-21 143-113 111-165-4-101 40-141-78-99-74Z'
            />
            <path className='lad-map-contour' d='M198 138l84 54-31 103-102 27-35-83Z' />
            <path className='lad-map-contour' d='M550 119l107 51 48 105-67 95-98-48-40-111Z' />
            {resolved.routes.map((route, index) => {
              const start = pointByName.get(route.from)
              const end = pointByName.get(route.to)
              if (!start || !end) return null
              const bendX = (start[0] + end[0]) / 2
              const bendY = Math.min(start[1], end[1]) - 42 - index * 4
              return (
                <path
                  className={`lad-route-line ${/关注|告警|拥堵/u.test(route.status ?? '') ? 'is-warning' : ''}`}
                  d={`M${start[0]} ${start[1]} Q${bendX} ${bendY} ${end[0]} ${end[1]}`}
                  key={`${route.from}-${route.to}-${index}`}
                />
              )
            })}
            {locations.map((name, index) => {
              const point = MAP_POINTS[index]
              return (
                <g key={name}>
                  <circle className='lad-point-ring' cx={point[0]} cy={point[1]} r='12' />
                  <circle className='lad-point-core' cx={point[0]} cy={point[1]} r='3.5' />
                  <text className='lad-point-label' x={point[0] + 16} y={point[1] - 12}>
                    {name}
                  </text>
                </g>
              )
            })}
          </svg>
        </article>

        <div className='lad-stack'>
          <article className='lad-panel'>
            <div className='lad-panel-title'>
              <h2>实时告警</h2>
              <span className='lad-panel-code'>ALERT STREAM</span>
            </div>
            <div className='lad-alert-list'>
              {resolved.alerts.slice(0, 3).map((item, index) => (
                <div
                  className='lad-alert'
                  key={`${item.time}-${index}`}
                  style={{ '--tone': alertTone(item.level) } as CSSProperties}
                >
                  <div className='lad-alert-meta'>
                    <span>{item.level}</span>
                    <span>{item.time}</span>
                  </div>
                  <p>{item.text}</p>
                </div>
              ))}
            </div>
          </article>

          <article className='lad-panel'>
            <div className='lad-panel-title'>
              <h2>航线运行</h2>
              <span className='lad-panel-code'>ROUTE STATUS</span>
            </div>
            <div className='lad-route-list'>
              {resolved.routes.slice(0, 4).map((route, index) => {
                const warning = /关注|告警|拥堵/u.test(route.status ?? '')
                return (
                  <div className='lad-route-row' key={`${route.from}-${route.to}-${index}`}>
                    <span className='lad-route-name'>
                      {route.from} → {route.to}
                    </span>
                    <span className={`lad-route-status ${warning ? 'is-warning' : ''}`}>{route.status ?? '通畅'}</span>
                  </div>
                )
              })}
            </div>
          </article>
        </div>
      </section>

      <section className='lad-footer'>
        <article className='lad-panel lad-trend'>
          <div className='lad-panel-title'>
            <h2>近 7 日飞行架次</h2>
            <span className='lad-panel-code'>FLIGHT TREND</span>
          </div>
          <svg
            className='lad-trend-svg'
            viewBox='0 0 620 150'
            preserveAspectRatio='none'
            role='img'
            aria-label='近七日飞行架次趋势'
          >
            <defs>
              <linearGradient id='ladTrendGradient' x1='0' x2='0' y1='0' y2='1'>
                <stop offset='0%' stopColor='#43d8ff' stopOpacity='0.28' />
                <stop offset='100%' stopColor='#43d8ff' stopOpacity='0' />
              </linearGradient>
            </defs>
            {trendPolyline ? (
              <>
                <polygon className='lad-trend-area' points={`22,142 ${trendPolyline} 598,142`} />
                <polyline className='lad-trend-line' points={trendPolyline} />
              </>
            ) : null}
            {trendPoints.map((point, index) => {
              const [x, y] = point.split(',').map(Number)
              const item = resolved.flightTrend[index]
              return (
                <g key={`${item?.label}-${index}`}>
                  <circle className='lad-trend-dot' cx={x} cy={y} r='4' />
                  <text className='lad-chart-value' x={x} y={Math.max(11, y - 10)} textAnchor='middle'>
                    {item?.value}
                  </text>
                  <text className='lad-chart-label' x={x} y='149' textAnchor='middle'>
                    {item?.label}
                  </text>
                </g>
              )
            })}
          </svg>
        </article>

        <article className='lad-panel'>
          <div className='lad-panel-title'>
            <h2>最近飞行任务</h2>
            <span className='lad-panel-code'>MISSION LOG</span>
          </div>
          <table className='lad-task-table'>
            <thead>
              <tr>
                <th style={{ width: '24%' }}>任务编号</th>
                <th style={{ width: '19%' }}>类型</th>
                <th>航线</th>
                <th style={{ width: '15%' }}>状态</th>
              </tr>
            </thead>
            <tbody>
              {resolved.tasks.slice(0, 4).map(task => (
                <tr key={task.id}>
                  <td className='lad-task-id'>{task.id}</td>
                  <td>{task.type}</td>
                  <td>{task.route}</td>
                  <td className='lad-task-status'>{task.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>
      </section>
    </div>
  )
}

export default LowAltitudeDashboard
