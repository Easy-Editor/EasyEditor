import { spawn } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const testOutput = resolve(packageRoot, '.test-dist')
const require = createRequire(import.meta.url)
const rollup = require.resolve('rollup/dist/bin/rollup')

const run = (command, args) =>
  new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { cwd: packageRoot, stdio: 'inherit' })
    child.once('error', rejectRun)
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolveRun()
        return
      }
      rejectRun(new Error(`${command} exited with ${signal ? `signal ${signal}` : `code ${code}`}`))
    })
  })

await rm(testOutput, { force: true, recursive: true })
try {
  await run(process.execPath, [rollup, '-c', 'rollup.test.config.js'])
  await run(process.execPath, ['--test', 'test/runtime.test.mjs'])
} finally {
  await rm(testOutput, { force: true, recursive: true })
}
