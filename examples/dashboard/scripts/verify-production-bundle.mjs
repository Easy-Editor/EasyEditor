import { readFile, readdir } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const dashboardRoot = fileURLToPath(new URL('..', import.meta.url))
const outputRoot = join(dashboardRoot, 'dist')
const forbiddenMarkers = Object.freeze([
  'AgentRuntimeE2E',
  'ScriptedModel',
  'dashboard-e2e-scripted-worker',
  'e2e-recoveries',
  'e2e-steps',
  'loadAgentRuntimeE2E',
  'runtime-e2e',
])

const listFiles = async directory => {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map(entry => {
      const path = join(directory, entry.name)
      return entry.isDirectory() ? listFiles(path) : [path]
    }),
  )
  return files.flat()
}

if (process.env.VITE_E2E === '1') {
  process.stdout.write('Skipped production bundle boundary verification for VITE_E2E=1.\n')
} else {
  const violations = []
  for (const path of await listFiles(outputRoot)) {
    if (!['.html', '.js', '.json', '.map', '.mjs'].includes(extname(path))) continue
    const source = await readFile(path, 'utf8')
    const markers = forbiddenMarkers.filter(marker => source.includes(marker))
    if (markers.length > 0) violations.push(`${relative(outputRoot, path)}: ${markers.join(', ')}`)
  }
  if (violations.length > 0) {
    throw new Error(`Production bundle contains Agent Runtime E2E code:\n${violations.join('\n')}`)
  }
  process.stdout.write('Verified production bundle excludes the Agent Runtime E2E stack.\n')
}
