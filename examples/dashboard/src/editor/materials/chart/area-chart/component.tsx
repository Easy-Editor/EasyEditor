import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import type { Ref } from 'react'
import { Area, AreaChart, CartesianGrid, XAxis } from 'recharts'

const chartData = [
  { month: 'January', desktop: 186, mobile: 80 },
  { month: 'February', desktop: 305, mobile: 200 },
  { month: 'March', desktop: 237, mobile: 120 },
  { month: 'April', desktop: 73, mobile: 190 },
  { month: 'May', desktop: 209, mobile: 130 },
  { month: 'June', desktop: 214, mobile: 140 },
]

const chartConfig = {
  desktop: {
    label: 'Desktop',
    color: 'var(--chart-1)',
  },
  mobile: {
    label: 'Mobile',
    color: 'var(--chart-2)',
  },
} satisfies ChartConfig

interface MAreaChartProps {
  ref: Ref<HTMLDivElement>
}

const MAreaChart = (props: MAreaChartProps) => {
  const { ref } = props

  return (
    <ChartContainer ref={ref} config={chartConfig} className='w-full h-full'>
      <AreaChart
        accessibilityLayer
        data={chartData}
        margin={{
          left: 12,
          right: 12,
        }}
      >
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey='month'
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          tickFormatter={value => value.slice(0, 3)}
        />
        <ChartTooltip cursor={false} content={<ChartTooltipContent indicator='dot' />} />
        <Area
          dataKey='mobile'
          type='natural'
          fill='var(--chart-1)'
          fillOpacity={0.4}
          stroke='var(--chart-1)'
          stackId='a'
          isAnimationActive={false}
        />
        <Area
          dataKey='desktop'
          type='natural'
          fill='var(--chart-2)'
          fillOpacity={0.4}
          stroke='var(--chart-2)'
          stackId='a'
          isAnimationActive={false}
        />
      </AreaChart>
    </ChartContainer>
  )
}

export default MAreaChart
