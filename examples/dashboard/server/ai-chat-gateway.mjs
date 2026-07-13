const AI_CHAT_PATH = '/api/ai/chat'
const DEFAULT_MODEL = 'gpt-4o'
const DEFAULT_UPSTREAM_URL = 'https://api.deerapi.com/v1/chat/completions'
const DEFAULT_TIMEOUT_MS = 15_000
const MAX_REQUEST_BODY_BYTES = 48 * 1024
const MAX_UPSTREAM_RESPONSE_BYTES = 256 * 1024
const MAX_MESSAGES = 10
const MAX_MESSAGE_BYTES = 2 * 1024
const MAX_MESSAGE_TOTAL_BYTES = 12 * 1024
const MAX_CANVAS_BYTES = 32 * 1024
const MAX_CANVAS_NODES = 200
const MAX_PROP_BYTES = 256

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()
const SAFE_PROP_KEYS = new Set(['alt', 'description', 'label', 'placeholder', 'text', 'title'])
const NODE_KEYS = new Set(['alias', 'componentName', 'locked', 'parentAlias', 'props', 'rect'])
const RECT_KEYS = new Set(['height', 'width', 'x', 'y'])

export const AI_SYSTEM_PROMPT = `你是 EasyEditor 低代码平台的受限编辑助手。服务端会提供只读的最小画布投影；alias 是本次请求临时生成的节点引用，禁止猜测或输出真实文档与节点标识。

输出协议：
- 先用一句简短中文说明计划，再输出一个 JSON 代码块。
- JSON 顶层必须且只能是 {"commands": [...]}，commands 必须为非空数组。
- 只能使用 insertNode、updateProps、removeNode、moveNode 四种命令。
- parentId 与 nodeId 必须填写画布投影中存在的 alias；禁止使用 documentId、revision 或任何未知字段。
- 插入节点格式：{"type":"insertNode","parentId":"节点 alias","at":0,"node":{"componentName":"Text","props":{"text":"标题"},"$dashboard":{"rect":{"x":100,"y":100,"width":300,"height":50}}}}
- 更新节点格式：{"type":"updateProps","nodeId":"节点 alias","props":{"text":"新标题"},"extras":{"$dashboard":{"rect":{"x":120,"y":100,"width":320,"height":50}}}}
- 删除节点格式：{"type":"removeNode","nodeId":"节点 alias"}
- 移动节点格式：{"type":"moveNode","nodeId":"节点 alias","parentId":"节点 alias","at":0}
- 允许创建的组件仅限 Group、Text、Image、AreaChart、BarChart、LineChart、PieChart、RadarChart、RadialChart；禁止创建 Root。
- 只输出普通 JSON 数据；禁止函数、表达式、访问器、原型键、可执行代码与未知操作。
- 不得删除或移动根节点，不得修改锁定节点，不得制造循环或重复 ID。
- 新增可视节点必须提供 props 和 $dashboard.rect；画布尺寸为 1920×1080。
- 批量修改必须放在同一个 commands 数组中，禁止 batch 命令。`

class GatewayError extends Error {
  constructor(status, code, message) {
    super(message)
    this.status = status
    this.code = code
  }
}

const byteLength = value => textEncoder.encode(value).byteLength
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)

const assertExactKeys = (value, allowed, path) => {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new GatewayError(400, 'INVALID_REQUEST', `${path} contains an unknown field`)
  }
}

const parseContentType = request => {
  const value = request.headers['content-type']
  if (typeof value !== 'string' || value.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
    throw new GatewayError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json')
  }
}

const readRequestBody = request =>
  new Promise((resolve, reject) => {
    const declaredLength = Number(request.headers['content-length'])
    if (Number.isFinite(declaredLength) && declaredLength > MAX_REQUEST_BODY_BYTES) {
      request.resume()
      reject(new GatewayError(413, 'REQUEST_TOO_LARGE', 'Request body is too large'))
      return
    }

    let bytes = 0
    const chunks = []
    const cleanup = () => {
      request.off('data', onData)
      request.off('end', onEnd)
      request.off('error', onError)
      request.off('aborted', onAborted)
    }
    const onData = chunk => {
      bytes += chunk.byteLength
      if (bytes > MAX_REQUEST_BODY_BYTES) {
        cleanup()
        request.resume()
        reject(new GatewayError(413, 'REQUEST_TOO_LARGE', 'Request body is too large'))
        return
      }
      chunks.push(chunk)
    }
    const onEnd = () => {
      cleanup()
      resolve(Buffer.concat(chunks).toString('utf8'))
    }
    const onError = () => {
      cleanup()
      reject(new GatewayError(400, 'INVALID_REQUEST', 'Request body could not be read'))
    }
    const onAborted = () => {
      cleanup()
      reject(new GatewayError(400, 'INVALID_REQUEST', 'Request was aborted'))
    }

    request.on('data', onData)
    request.on('end', onEnd)
    request.on('error', onError)
    request.on('aborted', onAborted)
  })

const validateMessages = value => {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_MESSAGES) {
    throw new GatewayError(400, 'INVALID_REQUEST', 'messages must be a bounded non-empty array')
  }

  let totalBytes = 0
  const messages = value.map((message, index) => {
    if (!isRecord(message)) throw new GatewayError(400, 'INVALID_REQUEST', `messages[${index}] is invalid`)
    assertExactKeys(message, new Set(['content', 'role']), `messages[${index}]`)
    if (message.role !== 'user' && message.role !== 'assistant') {
      throw new GatewayError(400, 'INVALID_REQUEST', `messages[${index}].role is invalid`)
    }
    if (typeof message.content !== 'string' || message.content.trim().length === 0) {
      throw new GatewayError(400, 'INVALID_REQUEST', `messages[${index}].content is invalid`)
    }
    const contentBytes = byteLength(message.content)
    if (contentBytes > MAX_MESSAGE_BYTES) {
      throw new GatewayError(400, 'INVALID_REQUEST', `messages[${index}].content is too large`)
    }
    totalBytes += contentBytes
    return { role: message.role, content: message.content }
  })

  if (totalBytes > MAX_MESSAGE_TOTAL_BYTES || messages.at(-1).role !== 'user') {
    throw new GatewayError(400, 'INVALID_REQUEST', 'messages exceed the allowed conversation boundary')
  }
  return messages
}

const validateRect = (value, path) => {
  if (!isRecord(value)) throw new GatewayError(400, 'INVALID_REQUEST', `${path} is invalid`)
  assertExactKeys(value, RECT_KEYS, path)
  if (![...RECT_KEYS].every(key => typeof value[key] === 'number' && Number.isFinite(value[key]))) {
    throw new GatewayError(400, 'INVALID_REQUEST', `${path} is invalid`)
  }
  return { x: value.x, y: value.y, width: value.width, height: value.height }
}

const validateProps = (value, path) => {
  if (!isRecord(value)) throw new GatewayError(400, 'INVALID_REQUEST', `${path} is invalid`)
  const result = {}
  for (const [key, candidate] of Object.entries(value)) {
    if (!SAFE_PROP_KEYS.has(key) || typeof candidate !== 'string' || byteLength(candidate) > MAX_PROP_BYTES) {
      throw new GatewayError(400, 'INVALID_REQUEST', `${path} contains an invalid property`)
    }
    result[key] = candidate
  }
  return result
}

const validateCanvas = value => {
  if (!isRecord(value)) throw new GatewayError(400, 'INVALID_REQUEST', 'canvas is invalid')
  assertExactKeys(value, new Set(['nodes', 'version']), 'canvas')
  if (
    value.version !== 1 ||
    !Array.isArray(value.nodes) ||
    value.nodes.length < 1 ||
    value.nodes.length > MAX_CANVAS_NODES
  ) {
    throw new GatewayError(400, 'INVALID_REQUEST', 'canvas is invalid')
  }
  if (byteLength(JSON.stringify(value)) > MAX_CANVAS_BYTES) {
    throw new GatewayError(400, 'INVALID_REQUEST', 'canvas is too large')
  }

  const aliases = new Set()
  const nodes = value.nodes.map((node, index) => {
    const path = `canvas.nodes[${index}]`
    if (!isRecord(node)) throw new GatewayError(400, 'INVALID_REQUEST', `${path} is invalid`)
    assertExactKeys(node, NODE_KEYS, path)
    if (
      typeof node.alias !== 'string' ||
      !/^n_[a-z0-9]{1,16}_[1-9]\d{0,3}$/.test(node.alias) ||
      aliases.has(node.alias)
    ) {
      throw new GatewayError(400, 'INVALID_REQUEST', `${path}.alias is invalid`)
    }
    if (
      typeof node.componentName !== 'string' ||
      node.componentName.length < 1 ||
      byteLength(node.componentName) > 128
    ) {
      throw new GatewayError(400, 'INVALID_REQUEST', `${path}.componentName is invalid`)
    }
    if (node.locked !== undefined && node.locked !== true) {
      throw new GatewayError(400, 'INVALID_REQUEST', `${path}.locked is invalid`)
    }
    if (node.parentAlias !== undefined && (!aliases.has(node.parentAlias) || node.parentAlias === node.alias)) {
      throw new GatewayError(400, 'INVALID_REQUEST', `${path}.parentAlias is invalid`)
    }

    const result = { alias: node.alias, componentName: node.componentName }
    if (node.parentAlias !== undefined) result.parentAlias = node.parentAlias
    if (node.locked === true) result.locked = true
    if (node.rect !== undefined) result.rect = validateRect(node.rect, `${path}.rect`)
    if (node.props !== undefined) result.props = validateProps(node.props, `${path}.props`)
    aliases.add(node.alias)
    return result
  })

  return { version: 1, nodes }
}

const validateRequest = value => {
  if (!isRecord(value)) throw new GatewayError(400, 'INVALID_REQUEST', 'Request must be a JSON object')
  assertExactKeys(value, new Set(['canvas', 'messages']), 'request')
  return {
    messages: validateMessages(value.messages),
    canvas: validateCanvas(value.canvas),
  }
}

const normalizeConfig = env => {
  const apiKey = typeof env.EASYEDITOR_AI_API_KEY === 'string' ? env.EASYEDITOR_AI_API_KEY.trim() : ''
  if (!apiKey) throw new GatewayError(503, 'AI_NOT_CONFIGURED', 'AI service is not configured')

  const model =
    typeof env.EASYEDITOR_AI_MODEL === 'string' && env.EASYEDITOR_AI_MODEL.trim()
      ? env.EASYEDITOR_AI_MODEL.trim()
      : DEFAULT_MODEL
  const upstream =
    typeof env.EASYEDITOR_AI_UPSTREAM_URL === 'string' && env.EASYEDITOR_AI_UPSTREAM_URL.trim()
      ? env.EASYEDITOR_AI_UPSTREAM_URL.trim()
      : DEFAULT_UPSTREAM_URL
  let upstreamUrl
  try {
    upstreamUrl = new URL(upstream)
  } catch {
    throw new GatewayError(503, 'AI_NOT_CONFIGURED', 'AI service is not configured')
  }
  if (!['http:', 'https:'].includes(upstreamUrl.protocol) || model.length > 128 || apiKey.length > 4096) {
    throw new GatewayError(503, 'AI_NOT_CONFIGURED', 'AI service is not configured')
  }
  return { apiKey, model, upstreamUrl: upstreamUrl.toString() }
}

const readUpstreamJson = async response => {
  if (!response.body) throw new GatewayError(502, 'AI_UPSTREAM_ERROR', 'AI service is unavailable')
  const reader = response.body.getReader()
  const chunks = []
  let bytes = 0
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    bytes += value.byteLength
    if (bytes > MAX_UPSTREAM_RESPONSE_BYTES) {
      await reader.cancel()
      throw new GatewayError(502, 'AI_UPSTREAM_ERROR', 'AI service is unavailable')
    }
    chunks.push(value)
  }
  const merged = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return JSON.parse(textDecoder.decode(merged))
  } catch {
    throw new GatewayError(502, 'AI_UPSTREAM_ERROR', 'AI service is unavailable')
  }
}

const normalizeUpstreamResponse = value => {
  const content = value?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || content.length === 0 || byteLength(content) > 128 * 1024) {
    throw new GatewayError(502, 'AI_UPSTREAM_ERROR', 'AI service is unavailable')
  }
  const result = { message: { role: 'assistant', content } }
  if (typeof value.id === 'string' && value.id.length > 0 && value.id.length <= 128) result.id = value.id
  return result
}

const writeJson = (response, status, payload) => {
  const body = JSON.stringify(payload)
  response.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'X-Content-Type-Options': 'nosniff',
  })
  response.end(body)
}

const normalizeUnexpectedError = error => {
  if (error instanceof GatewayError) return error
  if (error?.name === 'AbortError') {
    return new GatewayError(504, 'AI_UPSTREAM_TIMEOUT', 'AI service timed out')
  }
  return new GatewayError(502, 'AI_UPSTREAM_ERROR', 'AI service is unavailable')
}

export const createAiChatGateway =
  ({ env = process.env, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) =>
  async (request, response, next = () => {}) => {
    let pathname
    try {
      pathname = new URL(request.url ?? '/', 'http://localhost').pathname
    } catch {
      next()
      return
    }
    if (pathname !== AI_CHAT_PATH) {
      next()
      return
    }

    try {
      if (request.method !== 'POST') throw new GatewayError(405, 'METHOD_NOT_ALLOWED', 'Only POST is allowed')
      parseContentType(request)
      const config = normalizeConfig(env)
      const rawBody = await readRequestBody(request)
      let parsed
      try {
        parsed = JSON.parse(rawBody)
      } catch {
        throw new GatewayError(400, 'INVALID_REQUEST', 'Request body must be valid JSON')
      }
      const input = validateRequest(parsed)

      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), timeoutMs)
      let upstreamResponse
      try {
        upstreamResponse = await fetchImpl(config.upstreamUrl, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: config.model,
            messages: [
              { role: 'system', content: AI_SYSTEM_PROMPT },
              { role: 'system', content: `当前只读画布投影：\n${JSON.stringify(input.canvas)}` },
              ...input.messages,
            ],
            stream: false,
          }),
          signal: controller.signal,
        })
      } finally {
        clearTimeout(timeout)
      }

      if (!upstreamResponse.ok) {
        await upstreamResponse.body?.cancel().catch(() => undefined)
        throw new GatewayError(502, 'AI_UPSTREAM_ERROR', 'AI service is unavailable')
      }
      writeJson(response, 200, normalizeUpstreamResponse(await readUpstreamJson(upstreamResponse)))
    } catch (error) {
      const normalized = normalizeUnexpectedError(error)
      writeJson(response, normalized.status, {
        error: { code: normalized.code, message: normalized.message },
      })
    }
  }
