import { type CSSProperties, type PropsWithChildren, type Ref, forwardRef } from 'react'
import './component.css'

export type DivEnterAnimation = 'none' | 'fade' | 'slide-left' | 'slide-right' | 'rise'
export type DivPanelShape = 'rect' | 'hud-left' | 'hud-right'
export type DivVisualPreset = 'none' | 'hud-panel' | 'metric-axis' | 'corner-frame'

export interface DivProps extends PropsWithChildren {
  background?: string
  borderColor?: string
  borderRadius?: number
  borderWidth?: number
  enterAnimation?: DivEnterAnimation
  enterDelay?: number
  enterDuration?: number
  opacity?: number
  overflow?: CSSProperties['overflow']
  panelInset?: number
  panelShape?: DivPanelShape
  visualPreset?: DivVisualPreset
  shadowBlur?: number
  shadowColor?: string
  shadowOffsetY?: number
  style?: CSSProperties
}

const finiteNumber = (value: number | undefined, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const ENTER_ANIMATIONS = new Set<DivEnterAnimation>(['none', 'fade', 'slide-left', 'slide-right', 'rise'])
const PANEL_SHAPES = new Set<DivPanelShape>(['rect', 'hud-left', 'hud-right'])
const VISUAL_PRESETS = new Set<DivVisualPreset>(['none', 'hud-panel', 'metric-axis', 'corner-frame'])

export const normalizeDivEnterAnimation = (value: DivEnterAnimation | undefined): DivEnterAnimation =>
  value && ENTER_ANIMATIONS.has(value) ? value : 'none'

export const normalizeDivPanelShape = (value: DivPanelShape | undefined): DivPanelShape =>
  value && PANEL_SHAPES.has(value) ? value : 'rect'

export const normalizeDivVisualPreset = (value: DivVisualPreset | undefined): DivVisualPreset =>
  value && VISUAL_PRESETS.has(value) ? value : 'none'

const presetBackground = (preset: DivVisualPreset): string | undefined => {
  if (preset === 'hud-panel') {
    return 'linear-gradient(180deg, rgba(4, 16, 34, 0.64), rgba(2, 9, 22, 0.82))'
  }
  if (preset === 'metric-axis') {
    return 'radial-gradient(circle at 50% 5px, transparent 0 3px, #7899ad 4px 5px, transparent 6px), linear-gradient(90deg, transparent 47%, #607f94 48% 52%, transparent 53%)'
  }
  if (preset === 'corner-frame') {
    return 'linear-gradient(#75cbe8, #75cbe8) left top/18px 2px no-repeat, linear-gradient(#75cbe8, #75cbe8) left top/2px 18px no-repeat, linear-gradient(#75cbe8, #75cbe8) right top/18px 2px no-repeat, linear-gradient(#75cbe8, #75cbe8) right top/2px 18px no-repeat, linear-gradient(#75cbe8, #75cbe8) left bottom/18px 2px no-repeat, linear-gradient(#75cbe8, #75cbe8) left bottom/2px 18px no-repeat, linear-gradient(#75cbe8, #75cbe8) right bottom/18px 2px no-repeat, linear-gradient(#75cbe8, #75cbe8) right bottom/2px 18px no-repeat'
  }
  return undefined
}

const Div = forwardRef((props: DivProps, ref: Ref<HTMLDivElement>) => {
  const {
    background = 'transparent',
    borderColor = 'transparent',
    borderRadius = 0,
    borderWidth = 0,
    children,
    enterAnimation = 'none',
    enterDelay = 0,
    enterDuration = 700,
    opacity = 100,
    overflow = 'visible',
    panelInset = 24,
    panelShape = 'rect',
    visualPreset = 'none',
    shadowBlur = 0,
    shadowColor = 'rgba(0, 0, 0, 0.18)',
    shadowOffsetY = 0,
    style,
  } = props

  const normalizedBorderWidth = Math.max(0, finiteNumber(borderWidth, 0))
  const normalizedBorderRadius = Math.max(0, finiteNumber(borderRadius, 0))
  const normalizedOpacity = Math.min(100, Math.max(0, finiteNumber(opacity, 100))) / 100
  const normalizedEnterAnimation = normalizeDivEnterAnimation(enterAnimation)
  const normalizedEnterDelay = Math.min(30_000, Math.max(0, finiteNumber(enterDelay, 0)))
  const normalizedEnterDuration = Math.min(10_000, Math.max(100, finiteNumber(enterDuration, 700)))
  const normalizedPanelInset = Math.min(96, Math.max(0, finiteNumber(panelInset, 24)))
  const normalizedPanelShape = normalizeDivPanelShape(panelShape)
  const normalizedVisualPreset = normalizeDivVisualPreset(visualPreset)
  const normalizedShadowBlur = Math.max(0, finiteNumber(shadowBlur, 0))
  const normalizedShadowOffsetY = finiteNumber(shadowOffsetY, 0)
  const hasShadow = normalizedShadowBlur > 0 || normalizedShadowOffsetY !== 0
  const clipPath =
    normalizedPanelShape === 'hud-left'
      ? `polygon(0 0, calc(100% - ${normalizedPanelInset}px) ${normalizedPanelInset}px, 100% calc(100% - ${normalizedPanelInset}px), 0 100%)`
      : normalizedPanelShape === 'hud-right'
        ? `polygon(${normalizedPanelInset}px ${normalizedPanelInset}px, 100% 0, 100% 100%, 0 calc(100% - ${normalizedPanelInset}px))`
        : undefined

  return (
    <div
      ref={ref}
      data-div-enter-animation={normalizedEnterAnimation}
      data-div-panel-shape={normalizedPanelShape}
      data-div-visual-preset={normalizedVisualPreset}
      style={
        {
          '--div-enter-final-opacity': normalizedOpacity,
          animationDelay: normalizedEnterAnimation === 'none' ? undefined : `${normalizedEnterDelay}ms`,
          animationDuration: normalizedEnterAnimation === 'none' ? undefined : `${normalizedEnterDuration}ms`,
          animationFillMode: normalizedEnterAnimation === 'none' ? undefined : 'both',
          animationName:
            normalizedEnterAnimation === 'none' ? undefined : `easy-dashboard-div-enter-${normalizedEnterAnimation}`,
          animationTimingFunction: normalizedEnterAnimation === 'none' ? undefined : 'cubic-bezier(.2, .8, .2, 1)',
          position: 'relative',
          width: '100%',
          height: '100%',
          background: presetBackground(normalizedVisualPreset) ?? background,
          border: `${normalizedBorderWidth}px solid ${borderColor}`,
          borderRadius: normalizedBorderRadius,
          boxShadow: hasShadow ? `0 ${normalizedShadowOffsetY}px ${normalizedShadowBlur}px ${shadowColor}` : 'none',
          clipPath,
          opacity: normalizedOpacity,
          overflow,
          ...style,
        } as CSSProperties
      }
    >
      {children}
    </div>
  )
})

Div.displayName = 'Div'

export default Div
