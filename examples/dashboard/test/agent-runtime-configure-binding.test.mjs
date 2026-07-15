import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const dashboardRoot = fileURLToPath(new URL('..', import.meta.url))
const coreInstanceUrl = new URL('../../../packages/core/dist/instance.js', import.meta.url)
const moduleCache = new Map()

const resolveTypeScriptModule = (request, parentFilename) => {
  const basePath = resolve(dirname(parentFilename), request)
  const candidates = [basePath, `${basePath}.ts`, `${basePath}.tsx`, resolve(basePath, 'index.ts')]

  return candidates.find(candidate => {
    try {
      readFileSync(candidate)
      return true
    } catch {
      return false
    }
  })
}

const loadConfigureModule = relativePath => {
  const filename = resolve(dashboardRoot, relativePath)
  const cached = moduleCache.get(filename)
  if (cached) return cached.exports

  const source = readFileSync(filename, 'utf8')
  const transpiled = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: true,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: filename,
  }).outputText
  const loadedModule = { exports: {} }
  moduleCache.set(filename, loadedModule)

  const localRequire = request => {
    if (request === '@easy-editor/core') return {}
    if (request === './component') return { __esModule: true, default: function MaterialView() {} }
    if (request.startsWith('.')) {
      const resolved = resolveTypeScriptModule(request, filename)
      if (!resolved) throw new Error(`Unable to resolve ${request} from ${filename}`)
      return loadConfigureModule(relative(dashboardRoot, resolved))
    }
    throw new Error(`Unexpected dependency ${request} in ${filename}`)
  }

  const evaluate = new Function('require', 'module', 'exports', transpiled)
  evaluate(localRequire, loadedModule, loadedModule.exports)
  return loadedModule.exports
}

const flattenFields = items =>
  items.flatMap(item => [item, ...(Array.isArray(item.items) ? flattenFields(item.items) : [])])

const namedFields = configure => flattenFields(configure.props ?? []).filter(field => typeof field.name === 'string')

test('shared configure fields expose stable binding identities', () => {
  const { generalAdvancedConfigure, generalBasicConfigure } = loadConfigureModule('src/editor/materials/configure.ts')
  const fields = [...flattenFields(generalBasicConfigure), ...flattenFields(generalAdvancedConfigure)]
  const fieldsByIdentity = new Map(
    fields.map(field => [field.name ?? field.key, field]).filter(([identity]) => typeof identity === 'string'),
  )

  assert.deepEqual([...fieldsByIdentity.keys()], ['id', 'title', 'rect', 'condition'])
  assert.deepEqual(
    Object.fromEntries(
      [...fieldsByIdentity].map(([identity, field]) => [identity, { title: field.title, setter: field.setter }]),
    ),
    {
      id: { title: 'ID', setter: 'NodeIdSetter' },
      title: { title: '标题', setter: 'StringSetter' },
      rect: { title: '位置尺寸', setter: 'RectSetter' },
      condition: { title: '显隐', setter: 'SwitchSetter' },
    },
  )
})

test('callback-backed visibility keeps a stable non-prop identity', () => {
  const { generalAdvancedConfigure } = loadConfigureModule('src/editor/materials/configure.ts')
  const [conditionField] = flattenFields(generalAdvancedConfigure).filter(field => field.key === 'condition')

  assert.equal(conditionField.name, undefined)
  assert.equal(conditionField.key, 'condition')
  assert.equal(typeof conditionField.extraProps.getValue, 'function')
  assert.equal(typeof conditionField.extraProps.setValue, 'function')
  assert.equal(conditionField.extraProps.condition, undefined)
  assert.equal(conditionField.extraProps.autorun, undefined)
  assert.equal(conditionField.extraProps.onChange, undefined)
})

test('built Core SettingField mutates only the visibility sidecar', async t => {
  const { createEngine } = await import(coreInstanceUrl.href)
  const { generalAdvancedConfigure } = loadConfigureModule('src/editor/materials/configure.ts')
  const engine = createEngine({ hostWindow: null, trustPolicy: 'legacyTrusted' })
  t.after(async () => engine.destroy())
  await engine.init()

  engine.materials.createComponentMeta({
    componentName: 'VisibilityProbe',
    configure: { props: generalAdvancedConfigure },
  })
  engine.loadProject(
    {
      id: 'visibility-binding-project',
      version: '0.0.1',
      componentsMap: [],
      componentsTree: [
        {
          docId: 'visibility-page',
          id: 'visibility-root',
          componentName: 'VisibilityProbe',
          props: {},
          children: [],
        },
      ],
    },
    true,
  )

  const document = engine.project.currentDocument
  const visibilityField = document.root.settingEntry.items[0].items[0]

  assert.equal(visibilityField.name, undefined)
  assert.equal(visibilityField.config.key, 'condition')
  assert.equal(visibilityField.title, '显隐')
  assert.equal(visibilityField.setter, 'SwitchSetter')

  visibilityField.setValue(false)
  let schema = document.exportRaw()
  assert.equal(Object.hasOwn(schema.props ?? {}, 'condition'), false)
  assert.equal(document.root.getExtraPropValue('condition'), false)
  assert.equal(schema.condition, false)

  visibilityField.clearValue()
  schema = document.exportRaw()
  assert.equal(Object.hasOwn(schema.props ?? {}, 'condition'), false)
  assert.equal(document.root.getExtraPropValue('condition'), undefined)
  assert.equal(Object.hasOwn(schema, 'condition'), false)
})

test('Phase 2 does not pretend Text or charts are material-ready', () => {
  const cases = [
    {
      configurePath: 'src/editor/materials/basic/text/configure.ts',
      forbiddenNames: ['text'],
    },
    {
      configurePath: 'src/editor/materials/chart/bar-chart/configure.ts',
      forbiddenNames: ['data', 'config'],
    },
    {
      configurePath: 'src/editor/materials/chart/line-chart/configure.ts',
      forbiddenNames: ['data', 'config'],
    },
  ]

  for (const { configurePath, forbiddenNames } of cases) {
    const configure = loadConfigureModule(configurePath).default
    const names = new Set(namedFields(configure).map(field => field.name))

    for (const forbiddenName of forbiddenNames) {
      assert.equal(names.has(forbiddenName), false, `${configurePath} must not expose ${forbiddenName} during Phase 2`)
    }
  }
})

test('binding repair adds no Agent-specific material API', () => {
  const source = readFileSync(resolve(dashboardRoot, 'src/editor/materials/configure.ts'), 'utf8')

  assert.match(source, /key: 'condition'/)
  assert.doesNotMatch(source, /\bAgent(?:Host|Runtime|Capability|Material)?\b/)
})
