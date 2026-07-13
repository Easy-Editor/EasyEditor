import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

const decodeDoubleQuotedValue = value =>
  value.replace(/\\([\\"nrt])/g, (_match, escapedCharacter) => {
    if (escapedCharacter === 'n') return '\n'
    if (escapedCharacter === 'r') return '\r'
    if (escapedCharacter === 't') return '\t'
    return escapedCharacter
  })

const parseValue = (source, lineNumber) => {
  const value = source.trim()
  if (value.startsWith("'") || value.startsWith('"')) {
    const quote = value[0]
    if (!value.endsWith(quote) || value.length === 1) {
      throw new Error(`Invalid quoted value in server environment at line ${lineNumber}`)
    }
    const decoded = value.slice(1, -1)
    return quote === '"' ? decodeDoubleQuotedValue(decoded) : decoded
  }
  return value.replace(/\s+#.*$/, '').trim()
}

const copyEnvironment = source => {
  const environment = Object.create(null)
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string') environment[key] = value
  }
  return environment
}

export const loadServerEnvironment = async ({ directory, baseEnvironment = process.env, fileName = '.env' } = {}) => {
  if (!directory) throw new Error('Server environment directory is required')

  const environment = copyEnvironment(baseEnvironment)
  let contents
  try {
    contents = await readFile(resolve(directory, fileName), 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return environment
    throw error
  }

  for (const [index, sourceLine] of contents.split(/\r?\n/).entries()) {
    const line = sourceLine.trim()
    if (!line || line.startsWith('#')) continue

    const assignment = line.startsWith('export ') ? line.slice('export '.length).trimStart() : line
    const separator = assignment.indexOf('=')
    const key = separator < 0 ? '' : assignment.slice(0, separator).trim()
    if (!ENV_KEY_PATTERN.test(key)) {
      throw new Error(`Invalid server environment assignment at line ${index + 1}`)
    }
    if (Object.hasOwn(environment, key)) continue
    environment[key] = parseValue(assignment.slice(separator + 1), index + 1)
  }

  return environment
}
