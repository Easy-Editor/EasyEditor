import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { sanitizeDeclarationSource, sanitizeDeclarationTree } from '../scripts/sanitize-declarations.mjs'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test('declaration sanitizer removes only CSS side-effect imports', () => {
  const source = [
    "import type { Renderer } from './renderer';",
    "import './theme.css';",
    'import "./nested/component.css"',
    "export type { Renderer } from './renderer';",
    '',
  ].join('\n')

  assert.equal(
    sanitizeDeclarationSource(source),
    ["import type { Renderer } from './renderer';", "export type { Renderer } from './renderer';", ''].join('\n'),
  )
})

test('declaration sanitizer recursively rewrites declaration files only', async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'easy-editor-declarations-'))
  const nestedDirectory = join(temporaryRoot, 'nested')
  const declarationPath = join(nestedDirectory, 'index.d.ts')
  const sourcePath = join(nestedDirectory, 'index.ts')

  try {
    await mkdir(nestedDirectory)
    await writeFile(declarationPath, "import './index.css';\nexport declare const value = 1;\n")
    await writeFile(sourcePath, "import './index.css'\nexport const value = 1\n")

    assert.deepEqual(await sanitizeDeclarationTree(temporaryRoot), {
      filesChanged: 1,
      importsRemoved: 1,
    })
    assert.equal(await readFile(declarationPath, 'utf8'), 'export declare const value = 1;\n')
    assert.equal(await readFile(sourcePath, 'utf8'), "import './index.css'\nexport const value = 1\n")
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
})

test('dashboard type build wires the declaration sanitizer after TypeScript emit', async () => {
  const manifest = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))

  assert.equal(manifest.scripts.types, 'npm-run-all -nl types:src types:sanitize')
  assert.equal(manifest.scripts['types:src'], 'tsc --project tsconfig.build.json')
  assert.equal(manifest.scripts['types:sanitize'], 'node scripts/sanitize-declarations.mjs')
})
