import { MODEL_GATEWAY_PATH } from './contract.mjs'

export const MODEL_GATEWAY_VITE_PLUGIN_NAME = 'easy-editor-agent-model-gateway'

const COOKIE_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/u
const SESSION_TOKEN = /^[A-Za-z0-9._~+/=-]{1,4096}$/u

const localSessionOf = value => {
  if (value === undefined) return undefined
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).length !== 2 ||
    !Object.hasOwn(value, 'cookieName') ||
    !Object.hasOwn(value, 'token') ||
    !COOKIE_NAME.test(value.cookieName ?? '') ||
    !SESSION_TOKEN.test(value.token ?? '')
  ) {
    throw new TypeError('localSession must contain a valid cookieName and token')
  }
  return Object.freeze({ cookieName: value.cookieName, token: value.token })
}

const pathnameOf = request => {
  try {
    return new URL(request.url ?? '/', 'http://localhost').pathname
  } catch {
    return ''
  }
}

const isLoopbackAddress = value => value === '127.0.0.1' || value === '::1' || value === '::ffff:127.0.0.1'

const hasNamedCookie = (header, cookieName) =>
  typeof header === 'string' &&
  header.split(';').some(segment => {
    const separator = segment.indexOf('=')
    return separator > 0 && segment.slice(0, separator).trim() === cookieName
  })

const injectLocalSession = (request, localSession) => {
  if (
    !localSession ||
    pathnameOf(request) !== MODEL_GATEWAY_PATH ||
    !isLoopbackAddress(request.socket?.remoteAddress) ||
    !request.headers ||
    hasNamedCookie(request.headers.cookie, localSession.cookieName)
  ) {
    return
  }
  const sessionCookie = `${localSession.cookieName}=${localSession.token}`
  request.headers.cookie = request.headers.cookie ? `${request.headers.cookie}; ${sessionCookie}` : sessionCookie
}

export const createModelGatewayVitePlugin = (middleware, options = {}) => {
  if (typeof middleware !== 'function') throw new TypeError('middleware must be a function')
  const localSession = localSessionOf(options.localSession)
  return {
    name: MODEL_GATEWAY_VITE_PLUGIN_NAME,
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        injectLocalSession(request, localSession)
        void middleware(request, response, next)
      })
    },
  }
}
