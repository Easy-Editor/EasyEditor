import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url))
const baselinePath = fileURLToPath(new URL('./fixtures/public-package-api.json', import.meta.url))
const updateBaseline = process.argv.includes('--update')

// Core's stable instance entry has a stricter source/runtime allowlist in
// packages/core/test/framework-entry.test.mjs. The create package is a CLI and
// is covered by its command and packed-template smoke tests rather than an
// importable API surface.
const packageEntries = [
  ['@easy-editor/easypack', 'packages/easypack/src/index.ts'],
  ['@easy-editor/plugin-dashboard', 'packages/plugin-dashboard/src/index.ts'],
  ['@easy-editor/plugin-datasource', 'packages/plugin-datasource/src/index.ts'],
  ['@easy-editor/plugin-hotkey', 'packages/plugin-hotkey/src/index.ts'],
  ['@easy-editor/react-renderer', 'packages/react-renderer/src/index.ts'],
  ['@easy-editor/react-renderer-dashboard', 'packages/react-renderer-dashboard/src/index.ts'],
  ['@easy-editor/renderer-core', 'packages/renderer-core/src/index.ts'],
]

const resolveSymbol = (checker, symbol) =>
  symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol

const readPackageEntry = ([packageName, relativeEntryPath]) => {
  const entryPath = path.join(repositoryRoot, relativeEntryPath)
  const packageRoot = path.dirname(path.dirname(entryPath))
  const configPath = ts.findConfigFile(packageRoot, ts.sys.fileExists, 'tsconfig.build.json')
  assert.ok(configPath, `${packageName} must provide tsconfig.build.json`)

  const config = ts.readConfigFile(configPath, ts.sys.readFile)
  assert.equal(config.error, undefined, `${packageName} must have a readable TypeScript config`)
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath))
  const program = ts.createProgram({ options: { ...parsed.options, noEmit: true }, rootNames: parsed.fileNames })
  const checker = program.getTypeChecker()
  const sourceFile = program.getSourceFile(entryPath)
  assert.ok(sourceFile, `${packageName} public entry must be part of its build program`)
  const moduleSymbol = checker.getSymbolAtLocation(sourceFile)
  assert.ok(moduleSymbol, `${packageName} public entry must resolve to a module symbol`)

  const exports = checker.getExportsOfModule(moduleSymbol)
  return {
    all: exports.map(symbol => symbol.name).sort(),
    runtime: exports
      .filter(symbol => resolveSymbol(checker, symbol).flags & ts.SymbolFlags.Value)
      .map(symbol => symbol.name)
      .sort(),
  }
}

const current = Object.fromEntries(packageEntries.map(entry => [entry[0], readPackageEntry(entry)]))

if (updateBaseline) {
  writeFileSync(baselinePath, `${JSON.stringify(current, null, 2)}\n`)
  console.log(`Updated ${path.relative(repositoryRoot, baselinePath)}`)
} else {
  const reviewed = JSON.parse(readFileSync(baselinePath, 'utf8'))
  assert.deepEqual(
    current,
    reviewed,
    'A published package API changed. Review the compatibility impact, then run pnpm public-api:update intentionally.',
  )
  console.log(`Verified ${packageEntries.length} published package API baselines`)
}
