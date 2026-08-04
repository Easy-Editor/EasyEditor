import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import ts from 'typescript'

const navigationSourcePath = new URL('../src/renderer/pure/navigation.ts', import.meta.url)

function loadNavigationModule() {
  const output = ts.transpileModule(readFileSync(navigationSourcePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: navigationSourcePath.pathname,
  }).outputText
  const loaded = { exports: {} }
  const evaluate = new Function('module', 'exports', output)
  evaluate(loaded, loaded.exports)
  return loaded.exports
}

const { navigatePureDashboardPage } = loadNavigationModule()

const projectSchema = {
  version: '1.0.0',
  componentsTree: [
    {
      componentName: 'Root',
      fileName: 'overview',
    },
    {
      componentName: 'Root',
      fileName: 'details',
    },
  ],
  componentsMap: [{ componentName: 'RemoteChart', package: '@example/charts' }],
}

describe('navigatePureDashboardPage', () => {
  it('loads the destination before notifying consumers that the active page changed', async () => {
    const events = []

    const page = await navigatePureDashboardPage({
      projectSchema,
      path: 'details',
      onBeforeNavigate: async destination => {
        events.push(`before:${destination.fileName}`)
      },
      onPageChange: destination => {
        events.push(`change:${destination.fileName}`)
      },
    })

    assert.equal(page?.fileName, 'details')
    assert.deepEqual(events, ['before:details', 'change:details'])
  })

  it('does not notify consumers when the destination does not exist', async () => {
    const events = []

    const page = await navigatePureDashboardPage({
      projectSchema,
      path: 'missing',
      onPageChange: destination => {
        events.push(destination.fileName)
      },
    })

    assert.equal(page, undefined)
    assert.deepEqual(events, [])
  })
})
