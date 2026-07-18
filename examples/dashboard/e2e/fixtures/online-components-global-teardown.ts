import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, resolve } from 'node:path'

const DATA_ROOT_ENV = 'DASHBOARD_ONLINE_E2E_DATA_ROOT'
const DATA_ROOT_PREFIX = 'easy-editor-online-e2e-'

export default async function teardownOnlineComponentDataRoot(): Promise<void> {
  const configured = process.env[DATA_ROOT_ENV]
  if (!configured) return
  const root = resolve(configured)
  if (dirname(root) !== resolve(tmpdir()) || !basename(root).startsWith(DATA_ROOT_PREFIX)) {
    throw new Error(`Refusing to remove unsafe online-component E2E data root: ${root}`)
  }
  await rm(root, { force: true, recursive: true })
}
