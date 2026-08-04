import { parseGlobeShaderColor } from './spec'

export interface GlobeWebGLDrawOptions {
  ambientLight: number
  atmosphereColor: string
  centerLatitude: number
  centerLongitude: number
  daylightIntensity: number
  landColor: string
  lightAzimuth: number
  oceanColor: string
  surfaceBrightness: number
}

export interface GlobeWebGLRenderer {
  dispose: () => void
  draw: (options: GlobeWebGLDrawOptions) => void
}

export type GlobeWebGLMode = 'ready' | 'fallback'

export type GlobeWebGLRendererFactory = (
  canvas: HTMLCanvasElement,
  earthTexture: TexImageSource,
) => GlobeWebGLRenderer | null

const VERTEX_SHADER = `
attribute vec2 a_position;
varying vec2 v_uv;

void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`

const FRAGMENT_SHADER = `
precision highp float;

uniform sampler2D u_earth;
uniform float u_ambient_light;
uniform vec2 u_center;
uniform float u_daylight_intensity;
uniform vec3 u_atmosphere;
uniform vec3 u_land_tint;
uniform float u_light_azimuth;
uniform vec3 u_ocean_tint;
uniform float u_surface_brightness;
varying vec2 v_uv;

const float PI = 3.141592653589793;

void main() {
  vec2 point = (v_uv * 2.0 - 1.0) / 0.94;
  float radiusSquared = dot(point, point);
  if (radiusSquared > 1.0) discard;

  float depth = sqrt(max(0.0, 1.0 - radiusSquared));
  float longitude = u_center.x;
  float latitude = u_center.y;
  vec3 forward = vec3(cos(latitude) * cos(longitude), sin(latitude), cos(latitude) * sin(longitude));
  vec3 east = vec3(-sin(longitude), 0.0, cos(longitude));
  vec3 north = vec3(-sin(latitude) * cos(longitude), cos(latitude), -sin(latitude) * sin(longitude));
  vec3 worldNormal = normalize(east * point.x + north * point.y + forward * depth);

  float sampleLongitude = atan(worldNormal.z, worldNormal.x);
  float sampleLatitude = asin(clamp(worldNormal.y, -1.0, 1.0));
  vec2 textureUv = vec2(fract(sampleLongitude / (2.0 * PI) + 0.5), 0.5 - sampleLatitude / PI);
  vec3 textureColor = texture2D(u_earth, textureUv).rgb;

  float oceanLikelihood = smoothstep(0.015, 0.19, textureColor.b - textureColor.r * 0.72);
  vec3 controlledTint = mix(u_land_tint, u_ocean_tint, oceanLikelihood);
  vec3 surface = mix(textureColor, controlledTint, 0.13);
  float lightElevation = 0.56;
  float lightHorizontal = sqrt(1.0 - lightElevation * lightElevation);
  vec3 lightDirection = normalize(vec3(
    sin(u_light_azimuth) * lightHorizontal,
    lightElevation,
    cos(u_light_azimuth) * lightHorizontal
  ));
  float daylight = max(dot(normalize(vec3(point.x, point.y, depth)), lightDirection), 0.0);
  float diffuse = u_ambient_light + daylight * u_daylight_intensity;
  float rim = pow(1.0 - depth, 2.45);
  float specular = pow(daylight, 18.0) * 0.17;
  vec3 litSurface = (surface * diffuse + vec3(specular)) * u_surface_brightness;
  vec3 color = litSurface + u_atmosphere * rim * 0.92;
  float alpha = smoothstep(0.0, 0.018, 1.0 - radiusSquared);
  gl_FragColor = vec4(color, alpha);
}
`

const shaderColor = (value: string) => parseGlobeShaderColor(value) ?? [1, 1, 1]

const compileShader = (gl: WebGLRenderingContext, type: number, source: string) => {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader
  gl.deleteShader(shader)
  return null
}

export const createGlobeWebGLRenderer = (
  canvas: HTMLCanvasElement,
  earthTexture: TexImageSource,
): GlobeWebGLRenderer | null => {
  const gl = canvas.getContext('webgl', {
    alpha: true,
    antialias: true,
    depth: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: false,
  })
  if (!gl) return null

  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER)
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER)
  if (!vertexShader || !fragmentShader) {
    if (vertexShader) gl.deleteShader(vertexShader)
    if (fragmentShader) gl.deleteShader(fragmentShader)
    return null
  }

  const program = gl.createProgram()
  if (!program) {
    gl.deleteShader(vertexShader)
    gl.deleteShader(fragmentShader)
    return null
  }
  gl.attachShader(program, vertexShader)
  gl.attachShader(program, fragmentShader)
  gl.linkProgram(program)
  gl.deleteShader(vertexShader)
  gl.deleteShader(fragmentShader)
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program)
    return null
  }

  const buffer = gl.createBuffer()
  const texture = gl.createTexture()
  if (!buffer || !texture) {
    if (buffer) gl.deleteBuffer(buffer)
    if (texture) gl.deleteTexture(texture)
    gl.deleteProgram(program)
    return null
  }

  canvas.width = 768
  canvas.height = 768
  gl.viewport(0, 0, canvas.width, canvas.height)
  gl.useProgram(program)
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW)
  const position = gl.getAttribLocation(program, 'a_position')
  if (position < 0) {
    gl.deleteBuffer(buffer)
    gl.deleteTexture(texture)
    gl.deleteProgram(program)
    return null
  }
  gl.enableVertexAttribArray(position)
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)

  gl.activeTexture(gl.TEXTURE0)
  gl.bindTexture(gl.TEXTURE_2D, texture)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, earthTexture)
  gl.generateMipmap(gl.TEXTURE_2D)
  gl.uniform1i(gl.getUniformLocation(program, 'u_earth'), 0)

  const draw = (options: GlobeWebGLDrawOptions) => {
    if (gl.isContextLost()) return
    const radians = Math.PI / 180
    gl.useProgram(program)
    gl.uniform1f(gl.getUniformLocation(program, 'u_ambient_light'), options.ambientLight)
    gl.uniform2f(
      gl.getUniformLocation(program, 'u_center'),
      options.centerLongitude * radians,
      options.centerLatitude * radians,
    )
    gl.uniform1f(gl.getUniformLocation(program, 'u_daylight_intensity'), options.daylightIntensity)
    gl.uniform3fv(gl.getUniformLocation(program, 'u_atmosphere'), shaderColor(options.atmosphereColor))
    gl.uniform3fv(gl.getUniformLocation(program, 'u_land_tint'), shaderColor(options.landColor))
    gl.uniform1f(gl.getUniformLocation(program, 'u_light_azimuth'), options.lightAzimuth * radians)
    gl.uniform3fv(gl.getUniformLocation(program, 'u_ocean_tint'), shaderColor(options.oceanColor))
    gl.uniform1f(gl.getUniformLocation(program, 'u_surface_brightness'), options.surfaceBrightness)
    gl.clearColor(0, 0, 0, 0)
    gl.clear(gl.COLOR_BUFFER_BIT)
    gl.drawArrays(gl.TRIANGLES, 0, 6)
  }

  return {
    draw,
    dispose() {
      gl.deleteBuffer(buffer)
      gl.deleteTexture(texture)
      gl.deleteProgram(program)
    },
  }
}

export const createGlobeWebGLRendererLifecycle = (
  canvas: HTMLCanvasElement,
  earthTexture: TexImageSource,
  onModeChange: (mode: GlobeWebGLMode) => void,
  rendererFactory: GlobeWebGLRendererFactory = createGlobeWebGLRenderer,
): GlobeWebGLRenderer => {
  let disposed = false
  let renderer: GlobeWebGLRenderer | null = null
  let lastDrawOptions: GlobeWebGLDrawOptions | null = null

  const rebuild = () => {
    if (disposed) return
    renderer?.dispose()
    renderer = rendererFactory(canvas, earthTexture)
    if (!renderer) {
      onModeChange('fallback')
      return
    }
    if (lastDrawOptions) renderer.draw(lastDrawOptions)
    onModeChange('ready')
  }

  const handleContextLost = (event: Event) => {
    event.preventDefault()
    // The browser releases resources owned by a lost context. Drop the stale
    // renderer without issuing delete calls against that invalid context.
    renderer = null
    onModeChange('fallback')
  }

  const handleContextRestored = () => rebuild()

  canvas.addEventListener('webglcontextlost', handleContextLost)
  canvas.addEventListener('webglcontextrestored', handleContextRestored)
  rebuild()

  return {
    draw(options) {
      lastDrawOptions = options
      renderer?.draw(options)
    },
    dispose() {
      if (disposed) return
      disposed = true
      canvas.removeEventListener('webglcontextlost', handleContextLost)
      canvas.removeEventListener('webglcontextrestored', handleContextRestored)
      renderer?.dispose()
      renderer = null
      lastDrawOptions = null
    },
  }
}
