import {
  Bird,
  Factory,
  Fish,
  Gauge,
  Landmark,
  type LucideIcon,
  MapPinned,
  Mountain,
  Palmtree,
  PawPrint,
  Pickaxe,
  Shell,
  Sprout,
  Trees,
  Waves,
} from 'lucide-react'
import { type CSSProperties, type Ref, forwardRef } from 'react'

export type DashboardIconName =
  | 'bird'
  | 'factory'
  | 'fish'
  | 'gauge'
  | 'government'
  | 'island'
  | 'map'
  | 'mountain'
  | 'paw'
  | 'shell'
  | 'sprout'
  | 'trees'
  | 'waves'
  | 'mine'

export interface DashboardIconProps {
  background?: string
  borderColor?: string
  borderRadius?: number
  borderWidth?: number
  color?: string
  icon?: DashboardIconName
  padding?: number
  strokeWidth?: number
  style?: CSSProperties
}

const ICONS: Record<DashboardIconName, LucideIcon> = {
  bird: Bird,
  factory: Factory,
  fish: Fish,
  gauge: Gauge,
  government: Landmark,
  island: Palmtree,
  map: MapPinned,
  mountain: Mountain,
  paw: PawPrint,
  shell: Shell,
  sprout: Sprout,
  trees: Trees,
  waves: Waves,
  mine: Pickaxe,
}

const finite = (value: number | undefined, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const DashboardIcon = forwardRef((props: DashboardIconProps, ref: Ref<HTMLDivElement>) => {
  const {
    background = 'transparent',
    borderColor = 'transparent',
    borderRadius = 0,
    borderWidth = 0,
    color = '#8fdcff',
    icon = 'factory',
    padding = 8,
    strokeWidth = 1.6,
    style,
  } = props
  const Icon = ICONS[icon] ?? Factory

  return (
    <div
      ref={ref}
      aria-label={`图标：${icon}`}
      role='img'
      style={{
        alignItems: 'center',
        background,
        border: `${Math.max(0, finite(borderWidth, 0))}px solid ${borderColor}`,
        borderRadius: Math.max(0, finite(borderRadius, 0)),
        boxSizing: 'border-box',
        color,
        display: 'flex',
        height: '100%',
        justifyContent: 'center',
        overflow: 'hidden',
        padding: Math.max(0, finite(padding, 8)),
        width: '100%',
        ...style,
      }}
    >
      <Icon aria-hidden='true' height='100%' strokeWidth={Math.max(0.5, finite(strokeWidth, 1.6))} width='100%' />
    </div>
  )
})

DashboardIcon.displayName = 'DashboardIcon'

export default DashboardIcon
