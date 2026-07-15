import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const dashboardRoot = fileURLToPath(new URL('..', import.meta.url))
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
  const fieldsByName = new Map(fields.filter(field => field.name).map(field => [field.name, field]))

  assert.deepEqual([...fieldsByName.keys()], ['id', 'title', 'rect', 'condition'])
  assert.deepEqual(
    Object.fromEntries([...fieldsByName].map(([name, field]) => [name, { title: field.title, setter: field.setter }])),
    {
      id: { title: 'ID', setter: 'NodeIdSetter' },
      title: { title: '标题', setter: 'StringSetter' },
      rect: { title: '位置尺寸', setter: 'RectSetter' },
      condition: { title: '显隐', setter: 'SwitchSetter' },
    },
  )
})

test('callback-backed visibility keeps a stable sidecar lookup name', () => {
  const { generalAdvancedConfigure } = loadConfigureModule('src/editor/materials/configure.ts')
  const [conditionField] = flattenFields(generalAdvancedConfigure).filter(field => field.name === 'condition')

  assert.equal(typeof conditionField.extraProps.getValue, 'function')
  assert.equal(typeof conditionField.extraProps.setValue, 'function')
  assert.equal(conditionField.extraProps.condition, undefined)
  assert.equal(conditionField.extraProps.autorun, undefined)
  assert.equal(conditionField.extraProps.onChange, undefined)
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

  assert.match(source, /name: 'condition'/)
  assert.doesNotMatch(source, /\bAgent(?:Host|Runtime|Capability|Material)?\b/)
})
