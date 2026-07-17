import { ARTIFACT_SOURCE_MAX_BYTES } from '../../../lib/storage/artifact-contracts.mjs'
import { DASHBOARD_STORAGE_ERROR_CODE, DashboardStorageError } from '../../../lib/storage/errors.mjs'

const failure = reason => new DashboardStorageError(DASHBOARD_STORAGE_ERROR_CODE.validationFailed, reason)

const identifierStart = character => {
  if (character === '$' || character === '_') return true
  if (!character) return false
  return /[\p{ID_Start}]/u.test(character)
}

const identifierPart = character => {
  if (character === '$' || character === '_') return true
  if (!character) return false
  return /[\p{ID_Continue}]/u.test(character)
}

const lineTerminator = character =>
  character === '\n' || character === '\r' || character === '\u2028' || character === '\u2029'

const regexPrefixKeywords = new Set([
  'await',
  'case',
  'delete',
  'do',
  'else',
  'in',
  'instanceof',
  'new',
  'of',
  'return',
  'throw',
  'typeof',
  'void',
  'yield',
])

const regexPrefixPunctuators = new Set([
  '!',
  '!=',
  '!==',
  '%',
  '%=',
  '&',
  '&&',
  '&&=',
  '&=',
  '(',
  '*',
  '**',
  '**=',
  '*=',
  '+',
  '++',
  '+=',
  ',',
  '-',
  '--',
  '-=',
  ':',
  ';',
  '<',
  '<<',
  '<<=',
  '<=',
  '=',
  '==',
  '===',
  '=>',
  '>',
  '>=',
  '>>',
  '>>=',
  '>>>',
  '>>>=',
  '?',
  '??',
  '??=',
  '[',
  '^',
  '^=',
  '{',
  '|',
  '|=',
  '||',
  '||=',
  '~',
])

const punctuators = Object.freeze([
  '>>>=',
  '===',
  '!==',
  '>>>',
  '**=',
  '&&=',
  '||=',
  '??=',
  '<<=',
  '>>=',
  '...',
  '=>',
  '==',
  '!=',
  '<=',
  '>=',
  '++',
  '--',
  '&&',
  '||',
  '??',
  '?.',
  '**',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '&=',
  '|=',
  '^=',
  '<<',
  '>>',
])

class ArtifactSourceTokenizer {
  constructor(source) {
    this.source = source
    this.index = 0
    this.tokens = []
  }

  currentCodePoint() {
    if (this.index >= this.source.length) return ''
    return String.fromCodePoint(this.source.codePointAt(this.index))
  }

  advanceCodePoint() {
    const character = this.currentCodePoint()
    this.index += character.length
    return character
  }

  push(type, value, start) {
    const token = { type, value, start }
    this.tokens.push(token)
    return token
  }

  skipWhitespaceAndComments() {
    while (this.index < this.source.length) {
      const character = this.currentCodePoint()
      if (/\s/u.test(character)) {
        this.advanceCodePoint()
        continue
      }
      if (this.source.startsWith('//', this.index)) {
        this.index += 2
        while (this.index < this.source.length && !lineTerminator(this.currentCodePoint())) {
          this.advanceCodePoint()
        }
        continue
      }
      if (this.source.startsWith('/*', this.index)) {
        this.index += 2
        const close = this.source.indexOf('*/', this.index)
        if (close < 0) throw failure('artifact-source-unterminated-block-comment')
        this.index = close + 2
        continue
      }
      return
    }
  }

  readUnicodeEscape(isStart) {
    if (!this.source.startsWith('\\u', this.index)) {
      throw failure('artifact-source-invalid-identifier-escape')
    }
    this.index += 2
    let hexadecimal
    if (this.source[this.index] === '{') {
      const close = this.source.indexOf('}', this.index + 1)
      if (close < 0) throw failure('artifact-source-invalid-identifier-escape')
      hexadecimal = this.source.slice(this.index + 1, close)
      this.index = close + 1
      if (!/^[\da-fA-F]{1,6}$/u.test(hexadecimal)) throw failure('artifact-source-invalid-identifier-escape')
    } else {
      hexadecimal = this.source.slice(this.index, this.index + 4)
      if (!/^[\da-fA-F]{4}$/u.test(hexadecimal)) throw failure('artifact-source-invalid-identifier-escape')
      this.index += 4
    }
    const codePoint = Number.parseInt(hexadecimal, 16)
    if (codePoint > 0x10ffff) throw failure('artifact-source-invalid-identifier-escape')
    const character = String.fromCodePoint(codePoint)
    if (!(isStart ? identifierStart(character) : identifierPart(character))) {
      throw failure('artifact-source-invalid-identifier-escape')
    }
    return character
  }

  scanIdentifier() {
    const start = this.index
    let value = ''
    let first = true
    while (this.index < this.source.length) {
      if (this.source[this.index] === '\\') {
        value += this.readUnicodeEscape(first)
        first = false
        continue
      }
      const character = this.currentCodePoint()
      if (!(first ? identifierStart(character) : identifierPart(character))) break
      value += this.advanceCodePoint()
      first = false
    }
    return this.push('identifier', value, start)
  }

  scanString(quote) {
    const start = this.index
    this.index += 1
    let value = ''
    while (this.index < this.source.length) {
      const character = this.currentCodePoint()
      if (character === quote) {
        this.index += 1
        return this.push('string', value, start)
      }
      if (lineTerminator(character)) throw failure('artifact-source-unterminated-string')
      if (character === '\\') {
        this.index += 1
        if (this.index >= this.source.length) throw failure('artifact-source-unterminated-string')
        const escaped = this.advanceCodePoint()
        if (lineTerminator(escaped)) continue
        value += escaped
        continue
      }
      value += this.advanceCodePoint()
    }
    throw failure('artifact-source-unterminated-string')
  }

  scanNumber() {
    const start = this.index
    while (this.index < this.source.length && /[\w.]/u.test(this.currentCodePoint())) this.advanceCodePoint()
    return this.push('number', this.source.slice(start, this.index), start)
  }

  canStartRegex() {
    const previous = this.tokens.at(-1)
    if (!previous) return true
    if (previous.type === 'identifier') return regexPrefixKeywords.has(previous.value)
    return previous.type === 'punctuator' && regexPrefixPunctuators.has(previous.value)
  }

  scanRegex() {
    const start = this.index
    this.index += 1
    let inClass = false
    while (this.index < this.source.length) {
      const character = this.currentCodePoint()
      if (lineTerminator(character)) throw failure('artifact-source-unterminated-regex')
      if (character === '\\') {
        this.index += 1
        if (this.index >= this.source.length) throw failure('artifact-source-unterminated-regex')
        this.advanceCodePoint()
        continue
      }
      if (character === '[') inClass = true
      else if (character === ']') inClass = false
      else if (character === '/' && !inClass) {
        this.index += 1
        while (identifierPart(this.currentCodePoint())) this.advanceCodePoint()
        return this.push('regex', '', start)
      }
      this.advanceCodePoint()
    }
    throw failure('artifact-source-unterminated-regex')
  }

  scanTemplateExpression() {
    let braceDepth = 0
    while (this.index < this.source.length) {
      this.skipWhitespaceAndComments()
      if (this.index >= this.source.length) break
      if (this.source[this.index] === '}' && braceDepth === 0) {
        const start = this.index
        this.index += 1
        this.push('punctuator', '}', start)
        return
      }
      if (this.source[this.index] === '{') {
        const start = this.index
        this.index += 1
        braceDepth += 1
        this.push('punctuator', '{', start)
        continue
      }
      if (this.source[this.index] === '}') {
        const start = this.index
        this.index += 1
        braceDepth -= 1
        this.push('punctuator', '}', start)
        continue
      }
      this.scanToken()
    }
    throw failure('artifact-source-unterminated-template')
  }

  scanTemplate() {
    const start = this.index
    this.index += 1
    this.push('template', '', start)
    while (this.index < this.source.length) {
      const character = this.currentCodePoint()
      if (character === '`') {
        this.index += 1
        return
      }
      if (character === '\\') {
        this.index += 1
        if (this.index >= this.source.length) throw failure('artifact-source-unterminated-template')
        this.advanceCodePoint()
        continue
      }
      if (this.source.startsWith('${', this.index)) {
        const expressionStart = this.index
        this.index += 2
        this.push('punctuator', '{', expressionStart)
        this.scanTemplateExpression()
        continue
      }
      this.advanceCodePoint()
    }
    throw failure('artifact-source-unterminated-template')
  }

  scanPunctuator() {
    const start = this.index
    const punctuator = punctuators.find(candidate => this.source.startsWith(candidate, this.index))
    const value = punctuator ?? this.source[this.index]
    this.index += value.length
    return this.push('punctuator', value, start)
  }

  scanToken() {
    this.skipWhitespaceAndComments()
    if (this.index >= this.source.length) return null
    const character = this.currentCodePoint()
    if (character === "'" || character === '"') return this.scanString(character)
    if (character === '`') {
      this.scanTemplate()
      return this.tokens.at(-1)
    }
    if (identifierStart(character) || character === '\\') return this.scanIdentifier()
    if (/\d/u.test(character)) return this.scanNumber()
    if (character === '/' && !this.source.startsWith('//', this.index) && !this.source.startsWith('/*', this.index)) {
      if (this.canStartRegex()) return this.scanRegex()
    }
    return this.scanPunctuator()
  }

  tokenize() {
    while (this.index < this.source.length) this.scanToken()
    return this.tokens
  }
}

const assertNoImports = tokens => {
  for (const [index, token] of tokens.entries()) {
    if (token.type !== 'identifier' || token.value !== 'import') continue
    const previous = tokens[index - 1]
    if (previous?.type === 'punctuator' && (previous.value === '.' || previous.value === '?.')) continue
    throw failure('artifact-source-imports-are-forbidden')
  }
}

const assertNoExternalReexports = tokens => {
  for (const [index, token] of tokens.entries()) {
    if (token.type !== 'identifier' || token.value !== 'export') continue
    const next = tokens[index + 1]
    if (next?.value === '*') throw failure('artifact-source-imports-are-forbidden')
    if (next?.value !== '{') continue
    const closeIndex = findMatchingBrace(tokens, index + 1)
    if (tokens[closeIndex + 1]?.value === 'from') {
      throw failure('artifact-source-imports-are-forbidden')
    }
  }
}

const findMatchingBrace = (tokens, openIndex) => {
  let depth = 0
  for (let index = openIndex; index < tokens.length; index += 1) {
    if (tokens[index].value === '{') depth += 1
    if (tokens[index].value === '}') {
      depth -= 1
      if (depth === 0) return index
      if (depth < 0) break
    }
  }
  throw failure('artifact-source-default-export-object-is-unterminated')
}

const splitObjectEntries = tokens => {
  const entries = []
  let start = 0
  let braces = 0
  let parentheses = 0
  let brackets = 0
  for (let index = 0; index < tokens.length; index += 1) {
    const value = tokens[index].value
    if (value === '{') braces += 1
    else if (value === '}') braces -= 1
    else if (value === '(') parentheses += 1
    else if (value === ')') parentheses -= 1
    else if (value === '[') brackets += 1
    else if (value === ']') brackets -= 1
    else if (value === ',' && braces === 0 && parentheses === 0 && brackets === 0) {
      if (index > start) entries.push(tokens.slice(start, index))
      start = index + 1
    }
  }
  if (start < tokens.length) entries.push(tokens.slice(start))
  return entries.filter(entry => entry.length > 0)
}

const lifecycleName = entry => {
  if (entry[0]?.value === 'async' && entry[1]?.type === 'identifier') {
    return { name: entry[1].value, offset: 1, asynchronous: true }
  }
  if (entry[0]?.type === 'identifier' || entry[0]?.type === 'string') {
    return { name: entry[0].value, offset: 0, asynchronous: false }
  }
  return { name: '', offset: 0, asynchronous: false }
}

const findMatchingParenthesis = (tokens, openIndex) => {
  let depth = 0
  for (let index = openIndex; index < tokens.length; index += 1) {
    if (tokens[index].value === '(') depth += 1
    if (tokens[index].value === ')') {
      depth -= 1
      if (depth === 0) return index
      if (depth < 0) return -1
    }
  }
  return -1
}

const propertyFunctionMetadata = (entry, property) => {
  if (entry[property.offset + 1]?.value === '(') {
    return { isFunction: true, asynchronous: property.asynchronous, generator: false }
  }
  if (entry[property.offset + 1]?.value !== ':') {
    return { isFunction: false, asynchronous: false, generator: false }
  }
  const value = entry.slice(property.offset + 2)
  const asynchronous = value[0]?.value === 'async'
  const start = asynchronous ? 1 : 0
  if (value[start]?.value === 'function') {
    return {
      isFunction: true,
      asynchronous,
      generator: value[start + 1]?.value === '*',
    }
  }
  if (value[start]?.type === 'identifier' && value[start + 1]?.value === '=>') {
    return { isFunction: true, asynchronous, generator: false }
  }
  if (value[start]?.value === '(') {
    const closeIndex = findMatchingParenthesis(value, start)
    if (closeIndex >= 0 && value[closeIndex + 1]?.value === '=>') {
      return { isFunction: true, asynchronous, generator: false }
    }
  }
  return { isFunction: false, asynchronous: false, generator: false }
}

const lifecycleMetadata = (tokens, openIndex, closeIndex) => {
  const methods = new Set()
  for (const entry of splitObjectEntries(tokens.slice(openIndex + 1, closeIndex))) {
    if (entry[0]?.value === '...') throw failure('artifact-source-default-export-spreads-are-unsupported')
    if (entry[0]?.value === '[') throw failure('artifact-source-default-export-computed-properties-are-unsupported')
    const property = lifecycleName(entry)
    if (!['mount', 'update', 'destroy'].includes(property.name)) continue
    if (methods.has(property.name)) throw failure(`artifact-source-${property.name}-must-not-be-duplicated`)
    const functionMetadata = propertyFunctionMetadata(entry, property)
    if (!functionMetadata.isFunction) {
      throw failure(`artifact-source-${property.name}-must-be-a-function`)
    }
    if (functionMetadata.asynchronous || functionMetadata.generator) {
      throw failure(`artifact-source-${property.name}-must-be-synchronous`)
    }
    methods.add(property.name)
  }
  if (!methods.has('mount')) throw failure('artifact-source-mount-is-required')
  if (!methods.has('update')) throw failure('artifact-source-update-is-required')
  if (!methods.has('destroy')) throw failure('artifact-source-destroy-is-required')
  return [...methods].sort()
}

export const scanArtifactSource = source => {
  if (typeof source !== 'string' || source.trim().length === 0) {
    throw failure('artifact-source-must-be-a-non-empty-string')
  }
  const sourceBytes = new TextEncoder().encode(source).byteLength
  if (sourceBytes > ARTIFACT_SOURCE_MAX_BYTES) throw failure('artifact-source-exceeds-byte-budget')
  const tokens = new ArtifactSourceTokenizer(source).tokenize()
  assertNoImports(tokens)
  assertNoExternalReexports(tokens)
  const defaultExports = []
  for (let index = 0; index < tokens.length - 1; index += 1) {
    if (tokens[index].value === 'export' && tokens[index + 1].value === 'default') defaultExports.push(index)
  }
  if (defaultExports.length !== 1) throw failure('artifact-source-requires-one-default-export')
  const expressionIndex = defaultExports[0] + 2
  if (tokens[expressionIndex]?.value !== '{') {
    throw failure('artifact-source-default-export-must-be-an-object-literal')
  }
  const closeIndex = findMatchingBrace(tokens, expressionIndex)
  const lifecycleMethods = lifecycleMetadata(tokens, expressionIndex, closeIndex)
  const result = {
    schemaVersion: 1,
    moduleFormat: 'esm-default-object',
    lifecycleMethods: Object.freeze(lifecycleMethods),
    sourceBytes,
  }
  return Object.freeze(result)
}
