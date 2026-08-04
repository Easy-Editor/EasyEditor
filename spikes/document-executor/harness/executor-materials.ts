import { type ComponentMetadata, type EngineInstance, MaterialSource } from '@easy-editor/core/instance'
import { component as BarChart, meta as BarChartMeta } from '@easy-editor/materials-dashboard-bar-chart'
import { component as GeoMap, meta as GeoMapMeta } from '@easy-editor/materials-dashboard-geo-map'
import { component as LineChart, meta as LineChartMeta } from '@easy-editor/materials-dashboard-line-chart'
import { component as NumberFlip, meta as NumberFlipMeta } from '@easy-editor/materials-dashboard-number-flip'
import { component as PieChart, meta as PieChartMeta } from '@easy-editor/materials-dashboard-pie-chart'
import { component as Progress, meta as ProgressMeta } from '@easy-editor/materials-dashboard-progress'
import { component as ScrollList, meta as ScrollListMeta } from '@easy-editor/materials-dashboard-scroll-list'
import { component as Text, meta as TextMeta } from '@easy-editor/materials-dashboard-text'
import DashboardScene from '../../../examples/dashboard/src/editor/materials/inner/dashboard-scene/component'
import DashboardSceneMeta from '../../../examples/dashboard/src/editor/materials/inner/dashboard-scene/meta'
import DashboardIcon from '../../../examples/dashboard/src/editor/materials/inner/dashboard-icon/component'
import DashboardIconMeta from '../../../examples/dashboard/src/editor/materials/inner/dashboard-icon/meta'
import DateTime from '../../../examples/dashboard/src/editor/materials/inner/date-time/component'
import DateTimeMeta from '../../../examples/dashboard/src/editor/materials/inner/date-time/meta'
import Div from '../../../examples/dashboard/src/editor/materials/inner/div/component'
import DivMeta from '../../../examples/dashboard/src/editor/materials/inner/div/meta'

type ConfigureField = {
  name?: string
  items?: ConfigureField[]
  setter?: string | { componentName?: string; props?: Record<string, unknown> }
  extraProps?: Record<string, unknown>
}

const findConfigureField = (metadata: ComponentMetadata, fieldName: string): ConfigureField => {
  const pending = [...((metadata.configure?.props ?? []) as ConfigureField[])]
  while (pending.length > 0) {
    const field = pending.shift()
    if (!field) continue
    if (field.name === fieldName) return field
    if (field.items) pending.push(...field.items)
  }
  throw new Error(`${metadata.componentName} is missing configure field ${fieldName}`)
}

const pinMetadataVersion = (metadata: ComponentMetadata, version: string): ComponentMetadata => ({
  ...metadata,
  npm: metadata.npm ? { ...metadata.npm, version } : metadata.npm,
})

const pinnedTextMeta = pinMetadataVersion(TextMeta, '0.0.22')
const textFontWeight = findConfigureField(pinnedTextMeta, 'fontWeight')
textFontWeight.setter = {
  componentName: 'SelectSetter',
  props: {
    options: [
      { label: '正常', value: 'normal' },
      { label: '粗体', value: 'bold' },
    ],
  },
}
textFontWeight.extraProps = { ...textFontWeight.extraProps, defaultValue: 'normal' }

const pinnedPieChartMeta = pinMetadataVersion(PieChartMeta, '0.0.7')
for (const [fieldName, minimum, maximum, defaultValue] of [
  ['innerRadius', 0, 100, 0],
  ['outerRadius', 50, 100, 70],
] as const) {
  const field = findConfigureField(pinnedPieChartMeta, fieldName)
  field.setter = {
    componentName: 'SliderSetter',
    props: { min: minimum, max: maximum, step: 5, suffix: '%' },
  }
  field.extraProps = { ...field.extraProps, defaultValue }
}

const bundledMaterials = [
  { component: Div, meta: DivMeta },
  { component: DateTime, meta: DateTimeMeta },
  { component: DashboardIcon, meta: DashboardIconMeta },
  { component: DashboardScene, meta: DashboardSceneMeta },
  { component: Text, meta: pinnedTextMeta },
  { component: BarChart, meta: pinMetadataVersion(BarChartMeta, '0.0.7') },
  { component: LineChart, meta: pinMetadataVersion(LineChartMeta, '0.0.7') },
  { component: PieChart, meta: pinnedPieChartMeta },
  { component: NumberFlip, meta: pinMetadataVersion(NumberFlipMeta, '0.0.7') },
  { component: Progress, meta: pinMetadataVersion(ProgressMeta, '0.0.7') },
  { component: ScrollList, meta: pinMetadataVersion(ScrollListMeta, '0.0.7') },
  { component: GeoMap, meta: pinMetadataVersion(GeoMapMeta, '0.0.6') },
] as const

export const registerBundledExecutorMaterials = (engine: EngineInstance): void => {
  for (const material of bundledMaterials) {
    engine.materials.createComponentMeta(material.meta, {
      component: material.component,
      source: MaterialSource.BUILTIN,
    })
  }
}
