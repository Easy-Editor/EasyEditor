import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import type { Ref } from 'react'
import { CartesianGrid, Line, LineChart, XAxis } from 'recharts'
import {
  type DashboardRendererDataSource,
  resolveDashboardMaterialBinding,
  resolveDashboardRows,
} from '../../../data/binding'
import type { DashboardChartSeries } from '../bar-chart/component'

export const defaultLineChartData = [
  { month: 'January', desktop: 186 },
  { month: 'February', desktop: 305 },
  { month: 'March', desktop: 237 },
  { month: 'April', desktop: 73 },
  { month: 'May', desktop: 209 },
  { month: 'June', desktop: 214 },
]

export const defaultLineChartSeries: readonly DashboardChartSeries[] = [
  { dataKey: 'desktop', label: 'Desktop', color: 'var(--chart-1)' },
]

interface MLineChartProps {
  ref: Ref<HTMLDivElement>
  data?: ReadonlyArray<Record<string, unknown>>
  dataBindings?: unknown
  xKey?: string
  series?: readonly DashboardChartSeries[]
  __dataSource?: DashboardRendererDataSource
}

const MLineChart = (props: MLineChartProps) => {
  const { ref, data, dataBindings, xKey = 'month', series, __dataSource } = props
  const manualData = resolveDashboardRows(data, defaultLineChartData)
  const chartData = resolveDashboardRows(
    resolveDashboardMaterialBinding({
      bindingField: 'data',
      dataBindings,
      dataSource: __dataSource,
      fallback: manualData,
    }),
    manualData,
  )
  const chartSeries =
    Array.isArray(series) &&
    series.length > 0 &&
    series.every(item => item && typeof item.dataKey === 'string' && item.dataKey.length > 0)
      ? series
      : defaultLineChartSeries
  const chartConfig = Object.fromEntries(
    chartSeries.map((item, index) => [
      item.dataKey,
      { label: item.label ?? item.dataKey, color: item.color ?? `var(--chart-${(index % 5) + 1})` },
    ]),
  ) satisfies ChartConfig

  return (
    <ChartContainer ref={ref} config={chartConfig} className='w-full h-full'>
      <LineChart
        accessibilityLayer
        data={[...chartData]}
        margin={{
          left: 12,
          right: 12,
        }}
      >
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey={xKey}
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickFormatter={value => String(value).slice(0, 3)}
        />
        <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
        {chartSeries.map((item, index) => (
          <Line
            key={item.dataKey}
            dataKey={item.dataKey}
            type='natural'
            stroke={item.color ?? `var(--chart-${(index % 5) + 1})`}
            strokeWidth={2}
            dot={false}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ChartContainer>
  )
}

export default MLineChart
