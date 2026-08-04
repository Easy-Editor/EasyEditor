import type { ComponentProps } from 'react'
import { type PureRenderer, SimulatorRenderer } from '../src/index.js'

const renderer: typeof SimulatorRenderer = SimulatorRenderer
type PureRendererProps = ComponentProps<typeof PureRenderer>
const onPageChange: NonNullable<PureRendererProps['onPageChange']> = pageSchema => {
  void pageSchema.fileName
}

void renderer
void onPageChange
