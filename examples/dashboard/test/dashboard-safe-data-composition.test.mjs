import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const dashboardRoot = fileURLToPath(new URL('..', import.meta.url))
const core = await import(new URL('../../../packages/core/dist/instance.js', import.meta.url))
const contract = await import('../src/editor/data/contract.mjs')

const loadTypeScriptModule = (relativePath, dependencies) => {
  const filename = resolve(dashboardRoot, relativePath)
  const source = readFileSync(filename, 'utf8')
  const output = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText
  const loaded = { exports: {} }
  const localRequire = request => {
    if (Object.hasOwn(dependencies, request)) return dependencies[request]
    throw new Error(`Unexpected dependency ${request} from ${filename}`)
  }
  new Function('require', 'module', 'exports', output)(localRequire, loaded, loaded.exports)
  return loaded.exports
}

const composition = loadTypeScriptModule('src/editor/data/composition.ts', {
  './contract.mjs': contract,
})
const integration = loadTypeScriptModule('src/editor/data/editor-integration.ts', {
  './composition': composition,
  '@easy-editor/core/instance': core,
})

test('RENDER composes project legacy, root override, and safe catalog without polluting saved schema', async t => {
  const engine = core.createEngine({ hostWindow: null, trustPolicy: 'legacyTrusted' })
  t.after(() => engine.destroy())
  engine.designer.addPropsReducer(
    integration.createDashboardDataSourceRenderReducer({ safeDataEnabled: true }),
    integration.dashboardDataSourceRenderStage,
  )
  engine.materials.createComponentMeta({ componentName: 'Root' })
  await engine.init()

  engine.loadProject(
    {
      id: 'safe-data-project',
      version: '0.0.1',
      dataSource: {
        list: [
          { id: 'shared', type: 'fetch', options: { uri: 'https://project.example/shared' } },
          { id: 'project-only', type: 'fetch', options: { uri: 'https://project.example/only' } },
        ],
      },
      componentsTree: [
        {
          componentName: 'Root',
          isRoot: true,
          dataSource: {
            list: [{ id: 'shared', type: 'fetch', options: { uri: 'https://root.example/shared' } }],
          },
          props: {
            dataSources: {
              schemaVersion: 1,
              sources: [{ schemaVersion: 1, id: 'safe-static', kind: 'static', value: [{ value: 7 }] }],
            },
          },
        },
      ],
    },
    true,
  )

  const document = engine.project.currentDocument
  const rendered = document.export(core.TRANSFORM_STAGE.RENDER)
  assert.deepEqual(
    rendered.dataSource.list.map(item => item.id),
    ['shared', 'project-only', 'safe-static'],
  )
  assert.equal(rendered.dataSource.list[0].options.uri, 'https://root.example/shared')
  assert.equal(rendered.dataSource.list[2].type, composition.DASHBOARD_SAFE_DATA_SOURCE_TYPE)
  assert.equal(Object.hasOwn(rendered.props, 'dataSource'), false)

  const saved = document.export(core.TRANSFORM_STAGE.SAVE)
  const serialized = document.export(core.TRANSFORM_STAGE.SERIALIZE)
  for (const value of [saved, serialized]) {
    assert.deepEqual(
      value.dataSource.list.map(item => item.id),
      ['shared'],
    )
    assert.equal(value.props.dataSources.sources[0].id, 'safe-static')
    assert.equal(Object.hasOwn(value.props, 'dataSource'), false)
  }

  const savedProject = engine.project.export(core.TRANSFORM_STAGE.SAVE)
  const reloadedEngine = core.createEngine({ hostWindow: null, trustPolicy: 'legacyTrusted' })
  t.after(() => reloadedEngine.destroy())
  reloadedEngine.designer.addPropsReducer(
    integration.createDashboardDataSourceRenderReducer({ safeDataEnabled: true }),
    integration.dashboardDataSourceRenderStage,
  )
  reloadedEngine.materials.createComponentMeta({ componentName: 'Root' })
  await reloadedEngine.init()
  reloadedEngine.loadProject(structuredClone(savedProject), true)

  const reloadedRoot = reloadedEngine.project.currentDocument.export(core.TRANSFORM_STAGE.RENDER)
  assert.deepEqual(
    reloadedRoot.dataSource.list.map(item => item.id),
    ['shared', 'project-only', 'safe-static'],
  )
  assert.equal(reloadedRoot.dataSource.list[0].options.uri, 'https://root.example/shared')
  assert.equal(reloadedRoot.props.dataSources.sources[0].id, 'safe-static')
})

test('safe collisions fail closed at render time', async t => {
  const engine = core.createEngine({ hostWindow: null, trustPolicy: 'legacyTrusted' })
  t.after(() => engine.destroy())
  engine.designer.addPropsReducer(
    integration.createDashboardDataSourceRenderReducer({ safeDataEnabled: true }),
    integration.dashboardDataSourceRenderStage,
  )
  engine.materials.createComponentMeta({ componentName: 'Root' })
  await engine.init()
  engine.loadProject(
    {
      version: '0.0.1',
      dataSource: { list: [{ id: 'collision', type: 'fetch', options: { uri: 'https://legacy.example' } }] },
      componentsTree: [
        {
          componentName: 'Root',
          isRoot: true,
          props: {
            dataSources: {
              schemaVersion: 1,
              sources: [{ schemaVersion: 1, id: 'collision', kind: 'static', value: 'blocked' }],
            },
          },
        },
      ],
    },
    true,
  )

  assert.deepEqual(engine.project.currentDocument.export(core.TRANSFORM_STAGE.RENDER).dataSource, { list: [] })
})

test('disabled safe data flag ignores the safe catalog while preserving legacy composition', async t => {
  const engine = core.createEngine({ hostWindow: null, trustPolicy: 'legacyTrusted' })
  t.after(() => engine.destroy())
  engine.designer.addPropsReducer(
    integration.createDashboardDataSourceRenderReducer({ safeDataEnabled: false }),
    integration.dashboardDataSourceRenderStage,
  )
  engine.materials.createComponentMeta({ componentName: 'Root' })
  await engine.init()
  engine.loadProject(
    {
      version: '0.0.1',
      dataSource: { list: [{ id: 'legacy-only', type: 'fetch', options: { uri: 'https://legacy.example' } }] },
      componentsTree: [
        {
          componentName: 'Root',
          isRoot: true,
          props: {
            dataSources: {
              schemaVersion: 1,
              sources: [{ schemaVersion: 1, id: 'safe-disabled', kind: 'static', value: 'blocked' }],
            },
          },
        },
      ],
    },
    true,
  )

  assert.deepEqual(
    engine.project.currentDocument.export(core.TRANSFORM_STAGE.RENDER).dataSource.list.map(item => item.id),
    ['legacy-only'],
  )
})
