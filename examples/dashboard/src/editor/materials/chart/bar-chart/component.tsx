import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import type { Ref } from 'react'
import { Bar, BarChart, CartesianGrid, XAxis } from 'recharts'
import {
  type DashboardRendererDataSource,
  resolveDashboardMaterialBinding,
  resolveDashboardRows,
} from '../../../data/binding'

export const defaultBarChartData = [
  { month: 'January', desktop: 186, mobile: 80 },
  { month: 'February', desktop: 305, mobile: 200 },
  { month: 'March', desktop: 237, mobile: 120 },
  { month: 'April', desktop: 73, mobile: 190 },
  { month: 'May', desktop: 209, mobile: 130 },
  { month: 'June', desktop: 214, mobile: 140 },
]

export interface DashboardChartSeries {
  readonly dataKey: string
  readonly label?: string
  readonly color?: string
}

export const defaultBarChartSeries: readonly DashboardChartSeries[] = [
  { dataKey: 'desktop', label: 'Desktop', color: 'var(--chart-1)' },
  { dataKey: 'mobile', label: 'Mobile', color: 'var(--chart-2)' },
]

const normalizeSeries = (
  series: readonly DashboardChartSeries[] | undefined,
  fallback: readonly DashboardChartSeries[],
): readonly DashboardChartSeries[] => {
  if (!Array.isArray(series) || series.length === 0) return fallback
  const valid = series.every(
    item =>
      item !== null &&
      typeof item === 'object' &&
      typeof item.dataKey === 'string' &&
      item.dataKey.length > 0 &&
      (item.label === undefined || typeof item.label === 'string') &&
      (item.color === undefined || typeof item.color === 'string'),
  )
  return valid ? series : fallback
}

interface MBarChartProps {
  ref: Ref<HTMLDivElement>
  data?: ReadonlyArray<Record<string, unknown>>
  dataBindings?: unknown
  xKey?: string
  series?: readonly DashboardChartSeries[]
  __dataSource?: DashboardRendererDataSource
}

const MBarChart = (props: MBarChartProps) => {
  const { ref, data, dataBindings, xKey = 'month', series, __dataSource } = props
  const manualData = resolveDashboardRows(data, defaultBarChartData)
  const chartData = resolveDashboardRows(
    resolveDashboardMaterialBinding({
      bindingField: 'data',
      dataBindings,
      dataSource: __dataSource,
      fallback: manualData,
    }),
    manualData,
  )
  const chartSeries = normalizeSeries(series, defaultBarChartSeries)
  const chartConfig = Object.fromEntries(
    chartSeries.map((item, index) => [
      item.dataKey,
      { label: item.label ?? item.dataKey, color: item.color ?? `var(--chart-${(index % 5) + 1})` },
    ]),
  ) satisfies ChartConfig

  return (
    <ChartContainer ref={ref} config={chartConfig} className='w-full h-full'>
      <BarChart accessibilityLayer data={[...chartData]}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey={xKey}
          tickLine={false}
          tickMargin={10}
          axisLine={false}
          tickFormatter={value => String(value).slice(0, 3)}
        />
        <ChartTooltip cursor={false} content={<ChartTooltipContent indicator='dashed' />} />
        {chartSeries.map((item, index) => (
          <Bar
            key={item.dataKey}
            dataKey={item.dataKey}
            fill={item.color ?? `var(--chart-${(index % 5) + 1})`}
            radius={4}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    </ChartContainer>
  )
}

export default MBarChart
