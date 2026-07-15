import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { createDashboardServer } from '../server/index.mjs'

test('production server serves static assets and falls back to the SPA document', async t => {
  const distDir = await mkdtemp(join(tmpdir(), 'easy-editor-dashboard-'))
  await writeFile(join(distDir, 'index.html'), '<!doctype html><main>dashboard shell</main>')
  await writeFile(join(distDir, 'app.js'), 'console.log("asset")')

  const server = createDashboardServer({ distDir })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => {
    await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())))
    await rm(distDir, { recursive: true, force: true })
  })

  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const origin = `http://127.0.0.1:${address.port}`

  const asset = await fetch(`${origin}/app.js`)
  assert.equal(asset.status, 200)
  assert.match(asset.headers.get('content-type'), /text\/javascript/)
  assert.equal(await asset.text(), 'console.log("asset")')

  const spa = await fetch(`${origin}/editor/project/page`)
  assert.equal(spa.status, 200)
  assert.match(await spa.text(), /dashboard shell/)

  const missingAsset = await fetch(`${origin}/missing.js`)
  assert.equal(missingAsset.status, 404)
})
