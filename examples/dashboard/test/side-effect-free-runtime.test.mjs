import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { extname, join, relative, resolve } from 'node:path'
import test from 'node:test'
import ts from 'typescript'

const repositoryRoot = resolve(new URL('../../..', import.meta.url).pathname)
const runtimeRoots = [
  'examples/dashboard/src',
  'packages/create-easy-editor/template/dashboard/react/src',
  'packages/plugin-dashboard/src',
  'packages/plugin-datasource/src',
  'packages/plugin-hotkey/src',
  'packages/react-renderer-dashboard/src',
  'packages/react-renderer/src',
  'packages/renderer-core/src',
]

const walk = async directory => {
  const entries = await readdir(directory, { withFileTypes: true })
  return (
    await Promise.all(
      entries.map(entry => {
        const path = join(directory, entry.name)
        return entry.isDirectory() ? walk(path) : [path]
      }),
    )
  ).flat()
}

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

test('Dashboard and its runtime package graph never load the legacy Core root facade', async () => {
  const violations = []

  for (const sourceRoot of runtimeRoots) {
    const absoluteRoot = join(repositoryRoot, sourceRoot)
    const files = (await walk(absoluteRoot)).filter(path => ['.ts', '.tsx'].includes(extname(path)))
    for (const path of files) {
      const source = await readFile(path, 'utf8')
      if (loadsLegacyCoreRoot(source, path)) violations.push(relative(repositoryRoot, path))
    }
  }

  assert.deepEqual([...new Set(violations)].sort(), [])
})
