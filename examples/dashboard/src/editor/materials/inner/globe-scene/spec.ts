export interface GlobeSceneMarker {
  latitude: number
  longitude: number
  label?: string
  color?: string
  value?: number | string
}

export interface GlobeSceneSpec {
  ambientLight: number
  atmosphereColor: string
  autoRotate: boolean
  background: string
  centerLatitude: number
  centerLongitude: number
  globeScale: number
  introAnimation: boolean
  introDuration: number
  introLoop: boolean
  landColor: string
  daylightIntensity: number
  lightAzimuth: number
  markers: GlobeSceneMarker[]
  oceanColor: string
  rotationSpeed: number
  starDensity: number
  surfaceBrightness: number
}

export interface GlobeSceneInput extends Partial<Omit<GlobeSceneSpec, 'markers'>> {
  markers?: unknown
}

export interface OrthographicPoint {
  depth: number
  visible: boolean
  x: number
  y: number
}

export interface OrthographicPathResult {
  d: string
  ringCount: number
  usedFallback: boolean
}

type Position = [number, number]
type Vector3 = { x: number; y: number; z: number }

const MAX_MARKERS = 24
const DEGREE = Math.PI / 180
const SAFE_COLOR = /^(?:#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})|(?:rgb|hsl)a?\([\d.%\s,+-]+\)|[a-z]{3,24})$/iu
const SHADER_HEX_COLOR = /^#(?:[\da-f]{3,4}|[\da-f]{6}|[\da-f]{8})$/iu

export const DEFAULT_GLOBE_SCENE_SPEC: GlobeSceneSpec = {
  ambientLight: 0.32,
  atmosphereColor: '#6bdcff',
  autoRotate: true,
  background: '#020814',
  centerLatitude: 18,
  centerLongitude: 118,
  globeScale: 1,
  introAnimation: true,
  introDuration: 2700,
  introLoop: false,
  landColor: '#173f69',
  daylightIntensity: 0.82,
  lightAzimuth: -30,
  markers: [
    { latitude: 39.9, longitude: 116.4, label: '北京', color: '#61e9ff', value: 96 },
    { latitude: 31.2, longitude: 121.5, label: '上海', color: '#8fffd2', value: 88 },
    { latitude: 35.7, longitude: 139.7, label: '东京', color: '#57baff', value: 76 },
    { latitude: 1.3, longitude: 103.8, label: '新加坡', color: '#ffd76a', value: 69 },
    { latitude: -33.9, longitude: 151.2, label: '悉尼', color: '#73e6ff', value: 63 },
  ],
  oceanColor: '#04162c',
  rotationSpeed: 0.8,
  starDensity: 0.72,
  surfaceBrightness: 1,
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const finiteNumber = (value: unknown, fallback: number, minimum: number, maximum: number) =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback

const safeColor = (value: unknown, fallback: string) =>
  typeof value === 'string' && SAFE_COLOR.test(value.trim()) ? value.trim() : fallback

export const parseGlobeShaderColor = (value: unknown): [number, number, number] | null => {
  if (typeof value !== 'string') return null
  const source = value.trim()
  if (!SHADER_HEX_COLOR.test(source)) return null
  const compact = source.slice(1)
  const expanded =
    compact.length <= 4
      ? compact
          .split('')
          .map(character => character + character)
          .join('')
      : compact
  return [0, 2, 4].map(index => Number.parseInt(expanded.slice(index, index + 2), 16) / 255) as [number, number, number]
}

const safeShaderColor = (value: unknown, fallback: string) =>
  parseGlobeShaderColor(value) && typeof value === 'string' ? value.trim() : fallback

const normalizeLongitude = (value: number) => ((value + 540) % 360) - 180

const normalizeMarker = (value: unknown): GlobeSceneMarker | null => {
  if (!isRecord(value)) return null
  const latitude = finiteNumber(value.latitude, Number.NaN, -90, 90)
  const longitude = finiteNumber(value.longitude, Number.NaN, -180, 180)
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null

  const marker: GlobeSceneMarker = { latitude, longitude }
  if (typeof value.label === 'string' && value.label.trim()) marker.label = value.label.trim().slice(0, 36)
  if (typeof value.color === 'string') marker.color = safeColor(value.color, DEFAULT_GLOBE_SCENE_SPEC.atmosphereColor)
  if (typeof value.value === 'number' && Number.isFinite(value.value)) marker.value = value.value
  if (typeof value.value === 'string' && value.value.trim()) marker.value = value.value.trim().slice(0, 36)
  return marker
}

export const normalizeGlobeSceneSpec = (value: GlobeSceneInput | undefined): GlobeSceneSpec => {
  const source = isRecord(value) ? value : {}
  const markers = Array.isArray(source.markers)
    ? source.markers
        .slice(0, MAX_MARKERS)
        .map(normalizeMarker)
        .filter((item): item is GlobeSceneMarker => Boolean(item))
    : DEFAULT_GLOBE_SCENE_SPEC.markers

  return {
    ambientLight: finiteNumber(source.ambientLight, DEFAULT_GLOBE_SCENE_SPEC.ambientLight, 0.04, 0.5),
    atmosphereColor: safeShaderColor(source.atmosphereColor, DEFAULT_GLOBE_SCENE_SPEC.atmosphereColor),
    autoRotate: typeof source.autoRotate === 'boolean' ? source.autoRotate : DEFAULT_GLOBE_SCENE_SPEC.autoRotate,
    background: safeColor(source.background, DEFAULT_GLOBE_SCENE_SPEC.background),
    centerLatitude: finiteNumber(source.centerLatitude, DEFAULT_GLOBE_SCENE_SPEC.centerLatitude, -70, 70),
    centerLongitude: normalizeLongitude(
      finiteNumber(source.centerLongitude, DEFAULT_GLOBE_SCENE_SPEC.centerLongitude, -180, 180),
    ),
    globeScale: finiteNumber(source.globeScale, DEFAULT_GLOBE_SCENE_SPEC.globeScale, 0.35, 1.45),
    introAnimation:
      typeof source.introAnimation === 'boolean' ? source.introAnimation : DEFAULT_GLOBE_SCENE_SPEC.introAnimation,
    introDuration: finiteNumber(source.introDuration, DEFAULT_GLOBE_SCENE_SPEC.introDuration, 600, 10_000),
    introLoop: typeof source.introLoop === 'boolean' ? source.introLoop : DEFAULT_GLOBE_SCENE_SPEC.introLoop,
    landColor: safeShaderColor(source.landColor, DEFAULT_GLOBE_SCENE_SPEC.landColor),
    daylightIntensity: finiteNumber(source.daylightIntensity, DEFAULT_GLOBE_SCENE_SPEC.daylightIntensity, 0.3, 1.4),
    lightAzimuth: finiteNumber(source.lightAzimuth, DEFAULT_GLOBE_SCENE_SPEC.lightAzimuth, -180, 180),
    markers,
    oceanColor: safeShaderColor(source.oceanColor, DEFAULT_GLOBE_SCENE_SPEC.oceanColor),
    rotationSpeed: finiteNumber(source.rotationSpeed, DEFAULT_GLOBE_SCENE_SPEC.rotationSpeed, -8, 8),
    starDensity: finiteNumber(source.starDensity, DEFAULT_GLOBE_SCENE_SPEC.starDensity, 0, 1),
    surfaceBrightness: finiteNumber(source.surfaceBrightness, DEFAULT_GLOBE_SCENE_SPEC.surfaceBrightness, 0.35, 1.2),
  }
}

const rotateToView = (
  longitude: number,
  latitude: number,
  centerLongitude: number,
  centerLatitude: number,
): Vector3 => {
  const lambda = longitude * DEGREE
  const phi = latitude * DEGREE
  const lambda0 = centerLongitude * DEGREE
  const phi0 = centerLatitude * DEGREE
  const delta = lambda - lambda0
  const cosPhi = Math.cos(phi)
  const sinPhi = Math.sin(phi)
  const cosPhi0 = Math.cos(phi0)
  const sinPhi0 = Math.sin(phi0)
  const cosDelta = Math.cos(delta)

  return {
    x: cosPhi * Math.sin(delta),
    y: cosPhi0 * sinPhi - sinPhi0 * cosPhi * cosDelta,
    z: sinPhi0 * sinPhi + cosPhi0 * cosPhi * cosDelta,
  }
}

export const projectOrthographic = (
  longitude: number,
  latitude: number,
  centerLongitude: number,
  centerLatitude: number,
  radius = 1,
): OrthographicPoint => {
  const point = rotateToView(longitude, latitude, centerLongitude, centerLatitude)
  return {
    depth: point.z,
    visible: point.z >= -1e-6,
    x: point.x * radius,
    y: -point.y * radius,
  }
}

const validPosition = (value: unknown): value is Position =>
  Array.isArray(value) &&
  value.length >= 2 &&
  typeof value[0] === 'number' &&
  Number.isFinite(value[0]) &&
  typeof value[1] === 'number' &&
  Number.isFinite(value[1])

const extractGeometryRings = (geometry: unknown): Position[][] => {
  if (!isRecord(geometry) || !Array.isArray(geometry.coordinates)) return []
  if (geometry.type === 'Polygon') {
    return geometry.coordinates.filter(Array.isArray).map(ring => ring.filter(validPosition))
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.flatMap(polygon =>
      Array.isArray(polygon) ? polygon.filter(Array.isArray).map(ring => ring.filter(validPosition)) : [],
    )
  }
  return []
}

const extractRings = (geoJson: unknown): Position[][] => {
  if (!isRecord(geoJson)) return []
  if (geoJson.type === 'FeatureCollection' && Array.isArray(geoJson.features)) {
    return geoJson.features.flatMap(feature => (isRecord(feature) ? extractGeometryRings(feature.geometry) : []))
  }
  if (geoJson.type === 'Feature') return extractGeometryRings(geoJson.geometry)
  return extractGeometryRings(geoJson)
}

// A small built-in silhouette makes the component non-blank even if the local
// GeoJSON asset is accidentally absent or malformed at runtime.
export const FALLBACK_LAND_RINGS: Position[][] = [
  [
    [25, 37],
    [42, 54],
    [72, 55],
    [94, 71],
    [132, 56],
    [147, 43],
    [142, 21],
    [121, 8],
    [105, 21],
    [86, 8],
    [67, 24],
    [46, 14],
    [34, 30],
    [25, 37],
  ],
  [
    [112, -11],
    [154, -12],
    [152, -38],
    [132, -45],
    [115, -34],
    [112, -11],
  ],
  [
    [-18, 36],
    [16, 37],
    [43, 12],
    [33, -35],
    [12, -34],
    [-5, 5],
    [-18, 36],
  ],
]

const horizonIntersection = (from: Vector3, to: Vector3): Vector3 => {
  const denominator = from.z - to.z
  const ratio = Math.abs(denominator) < 1e-8 ? 0.5 : from.z / denominator
  const x = from.x + (to.x - from.x) * ratio
  const y = from.y + (to.y - from.y) * ratio
  const length = Math.hypot(x, y) || 1
  return { x: x / length, y: y / length, z: 0 }
}

const clipRingToFrontHemisphere = (ring: Position[], centerLongitude: number, centerLatitude: number): Vector3[] => {
  if (ring.length < 3) return []
  const points = ring.map(([longitude, latitude]) => rotateToView(longitude, latitude, centerLongitude, centerLatitude))
  const clipped: Vector3[] = []
  let previous = points.at(-1) as Vector3

  for (const current of points) {
    const previousVisible = previous.z >= 0
    const currentVisible = current.z >= 0
    if (previousVisible && currentVisible) clipped.push(current)
    if (previousVisible && !currentVisible) clipped.push(horizonIntersection(previous, current))
    if (!previousVisible && currentVisible) {
      clipped.push(horizonIntersection(previous, current))
      clipped.push(current)
    }
    previous = current
  }
  return clipped
}

const pathNumber = (value: number) => Number(value.toFixed(2))

export const buildOrthographicLandPath = (
  geoJson: unknown,
  centerLongitude: number,
  centerLatitude: number,
  radius = 410,
  centerX = 500,
  centerY = 500,
): OrthographicPathResult => {
  const sourceRings = extractRings(geoJson)
  const usedFallback = sourceRings.length === 0
  const rings = usedFallback ? FALLBACK_LAND_RINGS : sourceRings
  const paths = rings.flatMap(ring => {
    const points = clipRingToFrontHemisphere(ring, centerLongitude, centerLatitude)
    if (points.length < 3) return []
    return [
      `${points
        .map(
          (point, index) =>
            `${index === 0 ? 'M' : 'L'}${pathNumber(centerX + point.x * radius)},${pathNumber(
              centerY - point.y * radius,
            )}`,
        )
        .join('')}Z`,
    ]
  })

  if (paths.length === 0 && !usedFallback) {
    return buildOrthographicLandPath(
      { type: 'Polygon', coordinates: FALLBACK_LAND_RINGS },
      centerLongitude,
      centerLatitude,
      radius,
      centerX,
      centerY,
    )
  }

  return { d: paths.join(''), ringCount: paths.length, usedFallback }
}
