import { once } from 'node:events'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { chromium } from '@playwright/test'

import { MATERIAL_MANIFEST_BINDING_VERSION, createBrowserArtifactManifest } from './workspace-artifacts.mjs'

const DEFAULT_BROWSER_ARTIFACT_DIRECTORY = fileURLToPath(new URL('../.browser-dist/', import.meta.url))

const CONTENT_TYPES = Object.freeze({
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
})

const closeServer = async server => {
  if (!server.listening) return
  server.close()
  await once(server, 'close')
}

const startArtifactServer = async artifactDirectory => {
  const manifest = await createBrowserArtifactManifest(artifactDirectory)
  const allowedFiles = new Set(Object.keys(manifest.files))
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://127.0.0.1')
      const relativePath = decodeURIComponent(url.pathname === '/' ? 'index.html' : url.pathname.slice(1))
      if (!allowedFiles.has(relativePath)) {
        response.statusCode = 404
        response.end()
        return
      }
      const bytes = await readFile(resolve(artifactDirectory, relativePath))
      response.statusCode = 200
      response.setHeader('content-type', CONTENT_TYPES[extname(relativePath)] ?? 'application/octet-stream')
      response.end(bytes)
    } catch {
      response.statusCode = 500
      response.end()
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  if (!address || typeof address === 'string') {
    await closeServer(server)
    throw new Error('Document Executor material manifest probe could not resolve its local server address')
  }
  return {
    server,
    url: `http://127.0.0.1:${address.port}/index.html`,
  }
}

export const probeMaterialManifestBinding = async ({
  browserArtifactDirectory = DEFAULT_BROWSER_ARTIFACT_DIRECTORY,
} = {}) => {
  const artifactDirectory = resolve(browserArtifactDirectory)
  const { server, url } = await startArtifactServer(artifactDirectory)
  let browser
  try {
    browser = await chromium.launch({ headless: true })
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await page.goto(url, { waitUntil: 'load' })
    await page.waitForFunction(
      () => Boolean(globalThis.__EASY_EDITOR_DOCUMENT_EXECUTOR_BRIDGE__?.editorReady),
      undefined,
      { timeout: 30_000 },
    )
    const binding = await page.evaluate(async schemaVersion => {
      const bridge = globalThis.__EASY_EDITOR_DOCUMENT_EXECUTOR_BRIDGE__
      if (!bridge) throw new Error('Document Executor material manifest probe bridge is unavailable')
      await bridge.editorReady
      const authority = {
        projectId: 'material-manifest-probe',
        branchId: 'draft',
        sessionId: 'material-manifest-probe',
        taskId: 'material-manifest-probe',
      }
      const host = bridge.createInMemoryDashboardAgentHostFactory({ engine: bridge.engine }).create(authority)
      try {
        const observed = await host.observe({ schemaVersion: 1, ...authority, mode: 'full' })
        const materials = observed.projection?.['dashboard.core']?.materials
        if (!materials || !Number.isSafeInteger(materials.registryVersion)) {
          throw new Error('Dashboard Host observe did not expose the material registry version')
        }
        return {
          schemaVersion,
          registryVersion: materials.registryVersion,
          writableManifests: materials.writableManifests ?? [],
        }
      } finally {
        host.dispose()
      }
    }, Number(MATERIAL_MANIFEST_BINDING_VERSION))
    if (!Array.isArray(binding.writableManifests)) {
      throw new Error('Document Executor material manifest probe returned an invalid binding')
    }
    return binding
  } finally {
    await browser?.close().catch(() => undefined)
    await closeServer(server)
  }
}
