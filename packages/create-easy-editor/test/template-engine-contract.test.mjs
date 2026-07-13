import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const repositoryRoot = join(packageRoot, '../..')
const templateRoot = join(packageRoot, 'template/dashboard/react')
const templateSourceRoot = join(templateRoot, 'src')

const readTemplate = path => readFileSync(join(templateRoot, path), 'utf8')

const walkSourceFiles = directory =>
  readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const path = join(directory, entry.name)
    return entry.isDirectory() ? walkSourceFiles(path) : [path]
  })

const loadsLegacyCoreRoot = (source, path) => {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  )
  let violation = false

  const visit = node => {
    if (violation) return
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === '@easy-editor/core'
    ) {
      const clause = node.importClause
      if (!clause || (!clause.isTypeOnly && clause.name)) violation = true
      if (!clause?.isTypeOnly && clause?.namedBindings) {
        if (ts.isNamespaceImport(clause.namedBindings)) violation = true
        else if (clause.namedBindings.elements.some(binding => !binding.isTypeOnly)) violation = true
      }
    } else if (
      ts.isExportDeclaration(node) &&
      !node.isTypeOnly &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      node.moduleSpecifier.text === '@easy-editor/core' &&
      (!node.exportClause ||
        (ts.isNamedExports(node.exportClause) && node.exportClause.elements.some(binding => !binding.isTypeOnly)))
    ) {
      violation = true
    } else if (
      ts.isCallExpression(node) &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0]) &&
      node.arguments[0].text === '@easy-editor/core' &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(node.expression) && node.expression.text === 'require'))
    ) {
      violation = true
    }
    ts.forEachChild(node, visit)
  }

  visit(sourceFile)
  return violation
}

test('React dashboard template owns an explicit trusted engine instance', () => {
  const runtime = readTemplate('src/editor/runtime.ts')

  assert.match(
    runtime,
    /from ['"]@easy-editor\/core\/instance['"]/,
    'runtime must use the side-effect-free instance API',
  )
  assert.match(runtime, /\bcreateEngine\b/)
  assert.match(runtime, /\bEngineInstance\b/)
  assert.match(runtime, /trustPolicy:\s*['"]legacyTrusted['"]/)
  assert.match(runtime, /hostWindow:\s*window/)
  assert.match(runtime, /export const engine:\s*EngineInstance/)
})

test('React dashboard template never loads the legacy Core root facade', () => {
  const violations = []

  for (const file of walkSourceFiles(templateSourceRoot).filter(path => /\.tsx?$/.test(path))) {
    const source = readFileSync(file, 'utf8')
    if (loadsLegacyCoreRoot(source, file)) violations.push(relative(templateRoot, file))
  }

  assert.deepEqual(violations, [])
})

test('React dashboard template initializes, loads, and disposes its owned engine', () => {
  const editor = readTemplate('src/editor/index.ts')
  const installIndex = editor.indexOf('installLifecycleDisposal()')
  const bootstrapIndex = editor.indexOf('export const editorReady = bootstrapEditor()')

  assert.match(editor, /engine\.plugins\.registerPlugins/)
  assert.match(editor, /engine\.materials\.buildComponentMetasMap/)
  assert.match(editor, /engine\.setters\.registerSetter/)
  assert.match(editor, /await engine\.init\(\)/)
  assert.match(editor, /engine\.loadProject\(/)
  assert.match(editor, /engine\.destroy\(\)/)
  assert.match(editor, /const destroyAttempt\s*=\s*engine\.destroy\(\)/)
  assert.match(editor, /destroyPromise\s*=\s*destroyAttempt/)
  assert.match(editor, /destroyPromise\s*===\s*destroyAttempt/)
  assert.match(editor, /destroyPromise\s*=\s*undefined/)
  assert.match(editor, /validateProjectSchema\(schema,\s*engine\.trustPolicy\)/)
  assert.match(editor, /releaseSimulatorReady\?\.\(\)/)
  assert.match(editor, /window\.removeEventListener\(['"]pagehide['"]/)
  assert.match(editor, /pagehide/)
  assert.match(editor, /event\.persisted/)
  assert.doesNotMatch(editor, /addEventListener\(['"]pagehide['"][^\n]+once:\s*true/)
  assert.match(editor, /destroyEditor\(\)\.catch/)
  assert.match(editor, /new AggregateError\(\[startupError, cleanupError\]/)
  assert.match(editor, /import\.meta\.hot\.dispose\(\(\) => destroyEditor\(\)\)/)
  assert.doesNotMatch(editor, /import\.meta\.hot\.dispose\(\(\) => \{\s*void destroyEditor/)
  assert.ok(installIndex >= 0 && installIndex < bootstrapIndex)
  assert.doesNotMatch(editor, /version:\s*['"]0\.0\.1['"]/)
  assert.match(`${editor}\n${readTemplate('src/lib/schema.ts')}`, /version:\s*CURRENT_PROJECT_SCHEMA_VERSION/)
  assert.match(readTemplate('src/lib/schema.ts'), /CURRENT_PROJECT_SCHEMA_VERSION.*@easy-editor\/core\/instance/s)
})

test('React dashboard Text material does not forward arbitrary schema props to the DOM', () => {
  const text = readTemplate('src/editor/materials/basic/text/component.tsx')

  assert.doesNotMatch(text, /\.\.\.rest/)
  assert.doesNotMatch(text, /\{\.\.\.[^}]+\}/)
})

test('React dashboard template pins the compatible engine release set and package manager', () => {
  const manifest = JSON.parse(readTemplate('package.json'))
  const exampleManifest = JSON.parse(readFileSync(join(repositoryRoot, 'examples/dashboard/package.json'), 'utf8'))

  assert.equal(manifest.packageManager, 'pnpm@10.25.0')
  assert.deepEqual(
    [manifest, exampleManifest].map(({ dependencies }) => ({
      '@tailwindcss/vite': dependencies['@tailwindcss/vite'],
      tailwindcss: dependencies.tailwindcss,
    })),
    [
      { '@tailwindcss/vite': '4.1.18', tailwindcss: '4.1.18' },
      { '@tailwindcss/vite': '4.1.18', tailwindcss: '4.1.18' },
    ],
    'the generated template and source example must stay on the last Node 18-compatible Tailwind release',
  )
  assert.deepEqual(
    Object.fromEntries(
      [
        '@easy-editor/core',
        '@easy-editor/plugin-dashboard',
        '@easy-editor/plugin-hotkey',
        '@easy-editor/renderer-core',
        '@easy-editor/react-renderer',
        '@easy-editor/react-renderer-dashboard',
      ].map(name => [name, manifest.dependencies[name]]),
    ),
    {
      '@easy-editor/core': '^2.0.0',
      '@easy-editor/plugin-dashboard': '^2.0.0',
      '@easy-editor/plugin-hotkey': '^2.0.0',
      '@easy-editor/renderer-core': '^2.0.0',
      '@easy-editor/react-renderer': '^2.0.0',
      '@easy-editor/react-renderer-dashboard': '^2.0.0',
    },
  )
})
