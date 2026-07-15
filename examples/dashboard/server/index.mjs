import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { dirname, extname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const moduleDirectory = dirname(fileURLToPath(import.meta.url))
const defaultDistDirectory = resolve(moduleDirectory, '..', 'dist')

const CONTENT_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
  ['.woff', 'font/woff'],
  ['.woff2', 'font/woff2'],
])

const sendFile = async (request, response, filePath, cacheControl) => {
  const file = await stat(filePath)
  if (!file.isFile()) return false
  response.writeHead(200, {
    'Cache-Control': cacheControl,
    'Content-Length': file.size,
    'Content-Type': CONTENT_TYPES.get(extname(filePath).toLowerCase()) ?? 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
  })
  if (request.method === 'HEAD') response.end()
  else createReadStream(filePath).pipe(response)
  return true
}

const serveDashboard = async (request, response, distDirectory) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD', 'Cache-Control': 'no-store' }).end()
    return
  }

  let pathname
  try {
    pathname = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname)
  } catch {
    response.writeHead(400, { 'Cache-Control': 'no-store' }).end()
    return
  }

  const normalizedRoot = resolve(distDirectory)
  const requestedPath = resolve(normalizedRoot, `.${pathname}`)
  if (requestedPath !== normalizedRoot && !requestedPath.startsWith(`${normalizedRoot}${sep}`)) {
    response.writeHead(404, { 'Cache-Control': 'no-store' }).end()
    return
  }

  try {
    if (pathname !== '/' && (await sendFile(request, response, requestedPath, 'public, max-age=31536000, immutable'))) {
      return
    }
  } catch (error) {
    if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') {
      response.writeHead(500, { 'Cache-Control': 'no-store' }).end()
      return
    }
  }

  if (pathname !== '/' && extname(pathname)) {
    response.writeHead(404, { 'Cache-Control': 'no-store' }).end()
    return
  }

  try {
    await sendFile(request, response, join(normalizedRoot, 'index.html'), 'no-store')
  } catch {
    response.writeHead(503, { 'Cache-Control': 'no-store' }).end('Dashboard build is unavailable')
  }
}

export const createDashboardServer = ({ distDir = defaultDistDirectory } = {}) =>
  createServer((request, response) => {
    void serveDashboard(request, response, distDir)
  })

const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url
if (isMain) {
  const port = Number.parseInt(process.env.PORT ?? '4173', 10)
  const host = process.env.HOST ?? '127.0.0.1'
  const server = createDashboardServer()
  server.listen(port, host, () => {
    console.log(`EasyEditor Dashboard listening on http://${host}:${port}`)
  })
}
