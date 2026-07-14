import { readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const cssSideEffectImport =
  /^[\t ]*import[\t ]+(?:'[^'\r\n]+\.css(?:\?[^'\r\n]*)?'|"[^"\r\n]+\.css(?:\?[^"\r\n]*)?")[\t ]*;?[\t ]*(?:\r?\n|$)/gm

const sanitizeSource = source => {
  let importsRemoved = 0
  const sanitized = source.replace(cssSideEffectImport, () => {
    importsRemoved += 1
    return ''
  })
  return { importsRemoved, sanitized }
}

export const sanitizeDeclarationSource = source => sanitizeSource(source).sanitized

export const sanitizeDeclarationTree = async directory => {
  let filesChanged = 0
  let importsRemoved = 0

  const visit = async currentDirectory => {
    const entries = await readdir(currentDirectory, { withFileTypes: true })

    for (const entry of entries) {
      const path = resolve(currentDirectory, entry.name)
      if (entry.isDirectory()) {
        await visit(path)
        continue
      }
      if (!entry.isFile() || !entry.name.endsWith('.d.ts')) continue

      const source = await readFile(path, 'utf8')
      const result = sanitizeSource(source)
      if (result.importsRemoved === 0) continue

      await writeFile(path, result.sanitized)
      filesChanged += 1
      importsRemoved += result.importsRemoved
    }
  }

  await visit(resolve(directory))
  return { filesChanged, importsRemoved }
}

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isDirectRun) await sanitizeDeclarationTree(process.argv[2] ?? 'dist')
