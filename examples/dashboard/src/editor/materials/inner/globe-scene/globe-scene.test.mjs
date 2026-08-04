import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import ts from 'typescript'

const root = new URL('./', import.meta.url)
const read = path => readFile(new URL(path, root), 'utf8')

const importSpec = async () => {
  const source = await read('spec.ts')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: 'spec.ts',
  }).outputText
  return import(`data:text/javascript;base64,${Buffer.from(output).toString('base64')}`)
}

test('lighting defaults preserve the current GlobeScene appearance', async () => {
  const { DEFAULT_GLOBE_SCENE_SPEC, normalizeGlobeSceneSpec } = await importSpec()
  const normalized = normalizeGlobeSceneSpec(undefined)

  assert.equal(DEFAULT_GLOBE_SCENE_SPEC.surfaceBrightness, 1)
  assert.equal(DEFAULT_GLOBE_SCENE_SPEC.ambientLight, 0.32)
  assert.equal(DEFAULT_GLOBE_SCENE_SPEC.daylightIntensity, 0.82)
  assert.equal(DEFAULT_GLOBE_SCENE_SPEC.lightAzimuth, -30)
  assert.deepEqual(normalized, DEFAULT_GLOBE_SCENE_SPEC)
})

test('Agent lighting inputs are independently clamped to their supported ranges', async () => {
  const { DEFAULT_GLOBE_SCENE_SPEC, normalizeGlobeSceneSpec } = await importSpec()

  assert.deepEqual(
    normalizeGlobeSceneSpec({
      surfaceBrightness: 9,
      ambientLight: -1,
      daylightIntensity: 9,
      lightAzimuth: -999,
    }),
    {
      ...DEFAULT_GLOBE_SCENE_SPEC,
      surfaceBrightness: 1.2,
      ambientLight: 0.04,
      daylightIntensity: 1.4,
      lightAzimuth: -180,
    },
  )

  assert.deepEqual(
    normalizeGlobeSceneSpec({
      surfaceBrightness: 0,
      ambientLight: 2,
      daylightIntensity: 0,
      lightAzimuth: 999,
    }),
    {
      ...DEFAULT_GLOBE_SCENE_SPEC,
      surfaceBrightness: 0.35,
      ambientLight: 0.5,
      daylightIntensity: 0.3,
      lightAzimuth: 180,
    },
  )
})

test('configure exposes all lighting controls as bounded Agent-writable fields', async () => {
  const configure = await read('configure.ts')

  for (const [name, minimum, maximum] of [
    ['surfaceBrightness', '0.35', '1.2'],
    ['ambientLight', '0.04', '0.5'],
    ['daylightIntensity', '0.3', '1.4'],
    ['lightAzimuth', '-180', '180'],
  ]) {
    const field = new RegExp(
      `name: '${name}'[\\s\\S]*?propAgentCapability\\('${name}',[\\s\\S]*?minimum: ${minimum},[\\s\\S]*?maximum: ${maximum}`,
      'u',
    )
    assert.match(configure, field)
  }
})

test('WebGL lighting uniforms control the surface while atmosphere rim remains independent', async () => {
  const [webgl, component] = await Promise.all([read('webgl.ts'), read('component.tsx')])

  for (const uniform of ['u_surface_brightness', 'u_ambient_light', 'u_daylight_intensity', 'u_light_azimuth']) {
    assert.match(webgl, new RegExp(`uniform float ${uniform};`, 'u'))
    assert.match(webgl, new RegExp(`getUniformLocation\\(program, '${uniform}'\\)`, 'u'))
  }

  assert.match(webgl, /vec3 litSurface = \(surface \* diffuse \+ vec3\(specular\)\) \* u_surface_brightness;/u)
  assert.match(webgl, /vec3 color = litSurface \+ u_atmosphere \* rim \* 0\.92;/u)
  assert.match(webgl, /options\.lightAzimuth \* radians/u)

  for (const field of ['surfaceBrightness', 'ambientLight', 'daylightIntensity', 'lightAzimuth']) {
    assert.match(component, new RegExp(`${field}: scene\\.${field}`, 'u'))
  }
})
