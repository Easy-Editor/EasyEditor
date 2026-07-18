import { execFile } from 'node:child_process'
import { access, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { throwIfPromotionAborted } from './promotion-error.mjs'

const easypackDirectory = fileURLToPath(new URL('../../../../packages/easypack/', import.meta.url))
const easypackEntryPath = join(easypackDirectory, 'dist/index.js')
const rollupCli = join(easypackDirectory, 'node_modules/rollup/dist/bin/rollup')

let loadPromise

const runRollupBuild = signal =>
  new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [rollupCli, '-c'],
      {
        cwd: easypackDirectory,
        encoding: 'utf8',
        maxBuffer: 4 * 1024 * 1024,
        signal,
      },
      error => (error ? reject(error) : resolve()),
    )
  })

const importCompiledEasypack = async () => {
  const metadata = await stat(easypackEntryPath)
  return import(`${pathToFileURL(easypackEntryPath).href}?compiled=${metadata.mtimeMs}-${metadata.size}`)
}

const loadCompiledEasypack = async signal => {
  throwIfPromotionAborted(signal)
  try {
    await access(easypackEntryPath)
  } catch {
    await runRollupBuild(signal)
  }
  throwIfPromotionAborted(signal)
  let runtime = await importCompiledEasypack()
  if (typeof runtime?.buildEasypack !== 'function') {
    await runRollupBuild(signal)
    throwIfPromotionAborted(signal)
    runtime = await importCompiledEasypack()
  }
  if (typeof runtime?.buildEasypack !== 'function') {
    throw new TypeError('Compiled Easypack runtime does not export buildEasypack')
  }
  return runtime
}

export const loadEasypackRuntime = ({ signal } = {}) => {
  throwIfPromotionAborted(signal)
  loadPromise ??= loadCompiledEasypack(signal).catch(error => {
    loadPromise = undefined
    throw error
  })
  return loadPromise
}

export const checkEasypackRuntimeReadiness = async () => {
  try {
    await access(easypackEntryPath)
    return true
  } catch {
    try {
      await Promise.all([
        access(rollupCli),
        access(join(easypackDirectory, 'rollup.config.js')),
        access(join(easypackDirectory, 'src/index.ts')),
      ])
      return true
    } catch {
      return false
    }
  }
}

export const EASYPACK_RUNTIME_ENTRY_PATH = easypackEntryPath
