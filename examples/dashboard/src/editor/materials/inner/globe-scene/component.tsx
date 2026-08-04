import { type CSSProperties, type Ref, forwardRef, useEffect, useMemo, useRef, useState } from 'react'
import galaxyTextureUrl from './assets/2mass-galactic-plane.jpg'
import earthTextureUrl from './assets/earth-blue-marble.jpg'
import './component.css'
import { type GlobeSceneInput, buildOrthographicLandPath, normalizeGlobeSceneSpec, projectOrthographic } from './spec'
import { type GlobeWebGLRenderer, createGlobeWebGLRendererLifecycle } from './webgl'
import worldGeoJsonRaw from './world.geo.json?raw'

// Fixed, vendored NASA assets. Provenance is documented in assets/SOURCES.md.
// No GlobeScene field accepts an arbitrary image URL, shader, path or script.

export interface GlobeSceneProps extends GlobeSceneInput {
  style?: CSSProperties
}

type WebGLMode = 'pending' | 'ready' | 'fallback'

const parseWorldGeoJson = (value: string): unknown => {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

const WORLD_GEO_JSON = parseWorldGeoJson(worldGeoJsonRaw)

const useReducedMotion = () => {
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const update = () => setReduced(query.matches)
    update()
    query.addEventListener?.('change', update)
    return () => query.removeEventListener?.('change', update)
  }, [])

  return reduced
}

const useRotationOffset = (enabled: boolean, speed: number, reducedMotion: boolean) => {
  const [offset, setOffset] = useState(0)

  useEffect(() => {
    if (!enabled || reducedMotion || speed === 0 || typeof requestAnimationFrame !== 'function') {
      setOffset(0)
      return
    }
    let frame = 0
    let lastRender = 0
    const startedAt = performance.now()
    const tick = (now: number) => {
      if (now - lastRender >= 80) {
        setOffset(((now - startedAt) / 1000) * speed)
        lastRender = now
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [enabled, reducedMotion, speed])

  return offset
}

const GlobeScene = forwardRef((props: GlobeSceneProps, ref: Ref<HTMLDivElement>) => {
  const { style, ...input } = props
  const scene = normalizeGlobeSceneSpec(input)
  const reducedMotion = useReducedMotion()
  const rotationOffset = useRotationOffset(scene.autoRotate, scene.rotationSpeed, reducedMotion)
  const currentLongitude = scene.centerLongitude + rotationOffset
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const rendererRef = useRef<GlobeWebGLRenderer | null>(null)
  const [webglMode, setWebglMode] = useState<WebGLMode>('pending')
  const [earthAssetFailed, setEarthAssetFailed] = useState(false)
  const [galaxyAssetFailed, setGalaxyAssetFailed] = useState(false)
  const landFallback = useMemo(
    () => buildOrthographicLandPath(WORLD_GEO_JSON, currentLongitude, scene.centerLatitude),
    [currentLongitude, scene.centerLatitude],
  )

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || typeof Image === 'undefined') return
    let active = true
    const image = new Image()
    image.onload = () => {
      if (!active) return
      rendererRef.current = createGlobeWebGLRendererLifecycle(canvas, image, mode => {
        if (active) setWebglMode(mode)
      })
    }
    image.onerror = () => {
      if (!active) return
      setEarthAssetFailed(true)
      setWebglMode('fallback')
    }
    image.src = earthTextureUrl

    return () => {
      active = false
      image.onload = null
      image.onerror = null
      rendererRef.current?.dispose()
      rendererRef.current = null
    }
  }, [])

  useEffect(() => {
    if (webglMode !== 'ready') return
    rendererRef.current?.draw({
      ambientLight: scene.ambientLight,
      atmosphereColor: scene.atmosphereColor,
      centerLatitude: scene.centerLatitude,
      centerLongitude: currentLongitude,
      daylightIntensity: scene.daylightIntensity,
      landColor: scene.landColor,
      lightAzimuth: scene.lightAzimuth,
      oceanColor: scene.oceanColor,
      surfaceBrightness: scene.surfaceBrightness,
    })
  }, [
    currentLongitude,
    scene.ambientLight,
    scene.atmosphereColor,
    scene.centerLatitude,
    scene.daylightIntensity,
    scene.landColor,
    scene.lightAzimuth,
    scene.oceanColor,
    scene.surfaceBrightness,
    webglMode,
  ])

  const normalizedTextureLongitude = ((currentLongitude + 540) % 360) - 180
  const fallbackTrackOffset = -41.6667 - normalizedTextureLongitude / 10.8
  const introStyle = {
    '--globe-intro-duration': `${scene.introDuration}ms`,
    '--globe-intro-overshoot-scale': scene.globeScale * 1.08,
    '--globe-intro-start-scale': scene.globeScale * 0.18,
    '--globe-scale': scene.globeScale,
  } as CSSProperties

  return (
    <div
      ref={ref}
      className='globe-scene'
      data-globe-scene='ready'
      data-globe-scene-background={galaxyAssetFailed ? 'solid-fallback' : 'nasa-2mass'}
      style={
        {
          '--globe-atmosphere': scene.atmosphereColor,
          '--globe-background': scene.background,
          '--globe-galaxy-opacity': scene.starDensity,
          '--globe-land': scene.landColor,
          '--globe-ocean': scene.oceanColor,
          ...style,
        } as CSSProperties
      }
    >
      <img
        alt=''
        aria-hidden='true'
        className='globe-scene-galaxy'
        data-globe-scene-asset='nasa-2mass-galactic-plane'
        onError={() => setGalaxyAssetFailed(true)}
        src={galaxyTextureUrl}
      />
      <div className='globe-scene-background-shade' aria-hidden='true' />
      <div className='globe-scene-scan-ring is-outer' aria-hidden='true' />
      <div className='globe-scene-scan-ring is-inner' aria-hidden='true' />
      <div
        className={`globe-scene-orbit ${scene.introAnimation ? 'has-intro' : ''}`}
        data-globe-scene-intro={scene.introAnimation ? 'active' : 'none'}
        style={{ ...introStyle, animationIterationCount: scene.introLoop ? 'infinite' : 1 }}
      >
        <div className='globe-scene-halo is-wide' aria-hidden='true' />
        <div className='globe-scene-halo is-sharp' aria-hidden='true' />
        <canvas
          ref={canvasRef}
          aria-label='使用 NASA Blue Marble 纹理渲染的可旋转地球'
          className={`globe-scene-canvas ${webglMode === 'ready' ? 'is-ready' : ''}`}
          data-globe-scene-renderer={webglMode}
          role='img'
        />

        <div
          aria-label='使用 NASA Blue Marble 纹理的地球降级视图'
          className={`globe-scene-texture-fallback ${webglMode === 'ready' ? 'is-hidden' : ''}`}
          data-globe-scene-earth-fallback={earthAssetFailed ? 'geojson' : 'texture-mask'}
          role='img'
        >
          {earthAssetFailed ? (
            <svg aria-hidden='true' className='globe-scene-geo-fallback' viewBox='0 0 1000 1000'>
              <circle cx='500' cy='500' fill={scene.oceanColor} r='470' />
              <path d={landFallback.d} fill={scene.landColor} fillRule='evenodd' />
            </svg>
          ) : (
            <div
              className='globe-scene-texture-track'
              style={{ transform: `translate3d(${fallbackTrackOffset}%, 0, 0)` }}
            >
              {[0, 1, 2].map(index => (
                <img
                  alt=''
                  aria-hidden='true'
                  data-globe-scene-asset='nasa-blue-marble'
                  key={index}
                  onError={() => setEarthAssetFailed(true)}
                  src={earthTextureUrl}
                />
              ))}
            </div>
          )}
        </div>
        <div className='globe-scene-lighting' aria-hidden='true' />

        <div className='globe-scene-markers' aria-label='全球自然资源点'>
          {scene.markers.map(marker => {
            const point = projectOrthographic(
              marker.longitude,
              marker.latitude,
              currentLongitude,
              scene.centerLatitude,
              1,
            )
            if (!point.visible || point.depth < 0.08) return null
            const color = marker.color ?? scene.atmosphereColor
            const accessibleLabel = [marker.label, marker.value].filter(value => value !== undefined).join(' ')
            return (
              <span
                aria-label={accessibleLabel || '资源点'}
                className='globe-scene-marker'
                data-globe-scene-marker={marker.label ?? 'resource'}
                key={`${marker.longitude}-${marker.latitude}-${marker.label ?? ''}`}
                style={
                  {
                    '--globe-marker-color': color,
                    left: `${50 + point.x * 47}%`,
                    top: `${50 + point.y * 47}%`,
                  } as CSSProperties
                }
              >
                <i className='globe-scene-marker-wave' />
                <i className='globe-scene-marker-core' />
                {marker.label ? <b>{marker.label}</b> : null}
              </span>
            )
          })}
        </div>
      </div>
    </div>
  )
})

GlobeScene.displayName = 'GlobeScene'

export default GlobeScene
