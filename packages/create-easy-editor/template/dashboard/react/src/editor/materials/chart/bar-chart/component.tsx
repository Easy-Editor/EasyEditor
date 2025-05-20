import { type ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart'
import type { Ref } from 'react'
import { Bar, BarChart, CartesianGrid, XAxis } from 'recharts'

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

interface MBarChartProps {
  ref: Ref<HTMLDivElement>
}

const MBarChart = (props: MBarChartProps) => {
  const { ref } = props

  return (
    <ChartContainer ref={ref} config={chartConfig} className='w-full h-full'>
      <BarChart accessibilityLayer data={chartData}>
        <CartesianGrid vertical={false} />
        <XAxis
          dataKey='month'
          tickLine={false}
          tickMargin={10}
          axisLine={false}
          tickFormatter={value => value.slice(0, 3)}
        />
        <ChartTooltip cursor={false} content={<ChartTooltipContent indicator='dashed' />} />
        <Bar dataKey='desktop' fill='var(--chart-1)' radius={4} isAnimationActive={false} />
        <Bar dataKey='mobile' fill='var(--chart-2)' radius={4} isAnimationActive={false} />
      </BarChart>
    </ChartContainer>
  )
}

export default MBarChart
