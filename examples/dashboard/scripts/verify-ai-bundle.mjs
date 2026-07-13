import { readFile, readdir } from 'node:fs/promises'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const distDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
const textExtensions = new Set(['.css', '.html', '.js', '.json', '.map', '.svg', '.txt'])
const forbidden = ['VITE_DEER_API_KEY', 'EASYEDITOR_AI_API_KEY', 'api.deerapi.com/v1/chat/completions']

const files = []
const visit = async directory => {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) await visit(path)
    else if (textExtensions.has(extname(entry.name))) files.push(path)
  }
}

await visit(distDirectory)
for (const file of files) {
  const content = await readFile(file, 'utf8')
  for (const sentinel of forbidden) {
    if (content.includes(sentinel)) throw new Error(`Client bundle contains forbidden AI sentinel: ${sentinel}`)
  }
}

console.log(`AI client bundle boundary verified across ${files.length} files`)
