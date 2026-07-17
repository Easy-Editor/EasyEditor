import { OnlineComponentDependencyError } from './errors.mjs'

const MAX_TOKENS = 200_000
const IDENTIFIER_START = /[$_\p{ID_Start}]/u
const IDENTIFIER_CONTINUE = /(?:[$_\p{ID_Continue}]|\u200c|\u200d)/u
const FORBIDDEN_IDENTIFIERS = new Set([
  'Buffer',
  'EventSource',
  'Function',
  'SharedWorker',
  'WebSocket',
  'WebTransport',
  'Worker',
  'XMLHttpRequest',
  '__dirname',
  '__filename',
  'eval',
  'exports',
  'fetch',
  'global',
  'importScripts',
  'module',
  'process',
  'require',
  'sendBeacon',
])
const FORBIDDEN_PROPERTIES = new Set([...FORBIDDEN_IDENTIFIERS, '__proto__', 'constructor'])
const REGEX_PREFIX_IDENTIFIERS = new Set([
  'await',
  'case',
  'default',
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
const REGEX_PREFIX_PUNCTUATORS = new Set([
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
  '+=',
  ',',
  '-',
  '-=',
  '->',
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
const PUNCTUATORS = [
  '>>>=',
  '**=',
  '&&=',
  '===',
  '!==',
  '<<=',
  '>>=',
  '>>>',
  '??=',
  '||=',
  '?.',
  '=>',
  '**',
  '++',
  '--',
  '&&',
  '||',
  '??',
  '==',
  '!=',
  '<=',
  '>=',
  '<<',
  '>>',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '&=',
  '|=',
  '^=',
]

const rejectModule = () =>
  new OnlineComponentDependencyError('upstream-response-invalid', 502, 'Upstream response was rejected')

const codePointAt = (source, index) => {
  const codePoint = source.codePointAt(index)
  return codePoint === undefined ? null : String.fromCodePoint(codePoint)
}

const decodeUnicodeEscape = (source, index) => {
  if (source[index] !== '\\' || source[index + 1] !== 'u') throw rejectModule()
  if (source[index + 2] === '{') {
    const end = source.indexOf('}', index + 3)
    if (end === -1) throw rejectModule()
    const digits = source.slice(index + 3, end)
    if (!/^[0-9a-fA-F]{1,6}$/.test(digits)) throw rejectModule()
    const value = Number.parseInt(digits, 16)
    if (value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) throw rejectModule()
    return { character: String.fromCodePoint(value), nextIndex: end + 1 }
  }
  const digits = source.slice(index + 2, index + 6)
  if (!/^[0-9a-fA-F]{4}$/.test(digits)) throw rejectModule()
  const value = Number.parseInt(digits, 16)
  if (value >= 0xd800 && value <= 0xdfff) throw rejectModule()
  return { character: String.fromCodePoint(value), nextIndex: index + 6 }
}

const decodeEscape = (source, index) => {
  if (source[index] !== '\\' || index + 1 >= source.length) throw rejectModule()
  const escapeCode = source[index + 1]
  if (escapeCode === 'u') return decodeUnicodeEscape(source, index)
  if (escapeCode === 'x') {
    const digits = source.slice(index + 2, index + 4)
    if (!/^[0-9a-fA-F]{2}$/.test(digits)) throw rejectModule()
    return { character: String.fromCharCode(Number.parseInt(digits, 16)), nextIndex: index + 4 }
  }
  if (escapeCode === '\r') {
    return { character: '', nextIndex: source[index + 2] === '\n' ? index + 3 : index + 2 }
  }
  if (escapeCode === '\n' || escapeCode === '\u2028' || escapeCode === '\u2029') {
    return { character: '', nextIndex: index + 2 }
  }
  const simpleEscapes = { b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' }
  return { character: simpleEscapes[escapeCode] ?? escapeCode, nextIndex: index + 2 }
}

const isIdentifierStartAt = (source, index) => {
  if (source[index] === '\\') return source[index + 1] === 'u'
  const character = codePointAt(source, index)
  return character !== null && IDENTIFIER_START.test(character)
}

const isIdentifierContinueAt = (source, index) => {
  if (source[index] === '\\') return source[index + 1] === 'u'
  const character = codePointAt(source, index)
  return character !== null && IDENTIFIER_CONTINUE.test(character)
}

const canStartRegex = previous =>
  previous === null ||
  (previous.type === 'identifier' && REGEX_PREFIX_IDENTIFIERS.has(previous.value)) ||
  (previous.type === 'punctuator' && REGEX_PREFIX_PUNCTUATORS.has(previous.value))

const canEndExpression = token =>
  token !== undefined &&
  (token.type === 'identifier' ||
    token.type === 'literal' ||
    (token.type === 'punctuator' && [')', ']', '}'].includes(token.value)))

class ModuleLexer {
  constructor(source) {
    this.source = source
    this.index = 0
    this.tokens = []
  }

  push(token, moduleTopLevel) {
    this.tokens.push({ ...token, moduleTopLevel })
    if (this.tokens.length > MAX_TOKENS) throw rejectModule()
    return token
  }

  readIdentifier() {
    let value = ''
    let first = true
    while (
      this.index < this.source.length &&
      (first ? isIdentifierStartAt : isIdentifierContinueAt)(this.source, this.index)
    ) {
      let character
      if (this.source[this.index] === '\\') {
        const decoded = decodeUnicodeEscape(this.source, this.index)
        character = decoded.character
        this.index = decoded.nextIndex
      } else {
        character = codePointAt(this.source, this.index)
        this.index += character.length
      }
      if (!(first ? IDENTIFIER_START : IDENTIFIER_CONTINUE).test(character)) throw rejectModule()
      value += character
      first = false
    }
    return { type: 'identifier', value }
  }

  readString(quote) {
    this.index += 1
    let value = ''
    while (this.index < this.source.length) {
      const character = this.source[this.index]
      if (character === quote) {
        this.index += 1
        return { type: 'literal', value }
      }
      if (character === '\n' || character === '\r' || character === '\u2028' || character === '\u2029')
        throw rejectModule()
      if (character !== '\\') {
        value += character
        this.index += 1
        continue
      }
      const decoded = decodeEscape(this.source, this.index)
      value += decoded.character
      this.index = decoded.nextIndex
    }
    throw rejectModule()
  }

  skipLineComment() {
    this.index += 2
    while (this.index < this.source.length && !['\n', '\r', '\u2028', '\u2029'].includes(this.source[this.index])) {
      this.index += 1
    }
  }

  skipBlockComment() {
    const end = this.source.indexOf('*/', this.index + 2)
    if (end === -1) throw rejectModule()
    this.index = end + 2
  }

  skipRegex() {
    this.index += 1
    let inCharacterClass = false
    while (this.index < this.source.length) {
      const character = this.source[this.index]
      if (character === '\n' || character === '\r' || character === '\u2028' || character === '\u2029') {
        throw rejectModule()
      }
      if (character === '\\') {
        this.index += 2
        continue
      }
      if (character === '[') inCharacterClass = true
      else if (character === ']') inCharacterClass = false
      else if (character === '/' && !inCharacterClass) {
        this.index += 1
        while (/[a-z]/i.test(this.source[this.index] ?? '')) this.index += 1
        return { type: 'literal', value: null }
      }
      this.index += 1
    }
    throw rejectModule()
  }

  readNumber() {
    const consume = pattern => {
      while (pattern.test(this.source[this.index] ?? '')) this.index += 1
    }
    if (this.source[this.index] === '0' && /[xX]/.test(this.source[this.index + 1] ?? '')) {
      this.index += 2
      consume(/[0-9a-fA-F_]/)
    } else if (this.source[this.index] === '0' && /[bB]/.test(this.source[this.index + 1] ?? '')) {
      this.index += 2
      consume(/[01_]/)
    } else if (this.source[this.index] === '0' && /[oO]/.test(this.source[this.index + 1] ?? '')) {
      this.index += 2
      consume(/[0-7_]/)
    } else {
      consume(/[0-9_]/)
      if (this.source[this.index] === '.') {
        this.index += 1
        consume(/[0-9_]/)
      }
      if (/[eE]/.test(this.source[this.index] ?? '')) {
        this.index += 1
        if (/[+-]/.test(this.source[this.index] ?? '')) this.index += 1
        consume(/[0-9_]/)
      }
    }
    if (this.source[this.index] === 'n') this.index += 1
    return { type: 'literal', value: null }
  }

  readPunctuator() {
    const punctuator = PUNCTUATORS.find(value => this.source.startsWith(value, this.index)) ?? this.source[this.index]
    this.index += punctuator.length
    return { type: 'punctuator', value: punctuator }
  }

  readTemplate() {
    this.index += 1
    let staticValue = ''
    let hasExpression = false
    while (this.index < this.source.length) {
      const character = this.source[this.index]
      if (character === '`') {
        this.index += 1
        return { type: 'literal', value: hasExpression ? null : staticValue }
      }
      if (character === '\\') {
        const decoded = decodeEscape(this.source, this.index)
        staticValue += decoded.character
        this.index = decoded.nextIndex
        continue
      }
      if (character === '$' && this.source[this.index + 1] === '{') {
        hasExpression = true
        this.index += 2
        this.scanCode({ moduleTopLevel: false, stopAtClosingBrace: true })
        continue
      }
      staticValue += character
      this.index += 1
    }
    throw rejectModule()
  }

  scanCode({ moduleTopLevel, stopAtClosingBrace }) {
    let braceDepth = 0
    let previous = null
    while (this.index < this.source.length) {
      const character = this.source[this.index]
      if (/\s/u.test(character)) {
        this.index += 1
        continue
      }
      if (character === '/' && this.source[this.index + 1] === '/') {
        this.skipLineComment()
        continue
      }
      if (character === '/' && this.source[this.index + 1] === '*') {
        this.skipBlockComment()
        continue
      }
      if (character === '}' && stopAtClosingBrace && braceDepth === 0) {
        this.index += 1
        return
      }

      const isTopLevel = moduleTopLevel && braceDepth === 0
      let token
      if (isIdentifierStartAt(this.source, this.index)) token = this.readIdentifier()
      else if (character === '"' || character === "'") token = this.readString(character)
      else if (character === '`') token = this.readTemplate()
      else if (character === '/' && canStartRegex(previous)) token = this.skipRegex()
      else if (/[0-9]/.test(character) || (character === '.' && /[0-9]/.test(this.source[this.index + 1] ?? ''))) {
        token = this.readNumber()
      } else token = this.readPunctuator()

      if (token.type === 'punctuator') {
        if (token.value === '{') braceDepth += 1
        else if (token.value === '}') {
          if (braceDepth === 0) throw rejectModule()
          braceDepth -= 1
        }
      }
      previous = this.push(token, isTopLevel)
    }
    if (stopAtClosingBrace || braceDepth !== 0) throw rejectModule()
  }

  scan() {
    this.scanCode({ moduleTopLevel: true, stopAtClosingBrace: false })
    return this.tokens
  }
}

const evaluateStaticString = tokens => {
  if (tokens.length === 0 || tokens.length % 2 === 0) return null
  let value = ''
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (index % 2 === 0) {
      if (token.type !== 'literal' || typeof token.value !== 'string') return null
      value += token.value
    } else if (token.type !== 'punctuator' || token.value !== '+') return null
  }
  return value
}

const validateComputedProperties = tokens => {
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokens[index].type !== 'punctuator' || tokens[index].value !== '[') continue
    const memberBase = tokens[index - 1]?.value === '?.' ? tokens[index - 2] : tokens[index - 1]
    if (!canEndExpression(memberBase)) continue
    let depth = 1
    let end = index + 1
    for (; end < tokens.length && depth > 0; end += 1) {
      const token = tokens[end]
      if (token.type !== 'punctuator') continue
      if (token.value === '[') depth += 1
      else if (token.value === ']') depth -= 1
    }
    if (depth !== 0) throw rejectModule()
    const property = evaluateStaticString(tokens.slice(index + 1, end - 1))
    if (property !== null && FORBIDDEN_PROPERTIES.has(property)) throw rejectModule()
  }
}

const validateModuleTokens = tokens => {
  let sawExport = false
  let exportStatement = false
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token.type === 'identifier') {
      if (token.value === 'import' || FORBIDDEN_IDENTIFIERS.has(token.value)) throw rejectModule()
      if (
        FORBIDDEN_PROPERTIES.has(token.value) &&
        tokens[index - 1]?.type === 'punctuator' &&
        ['.', '?.'].includes(tokens[index - 1].value)
      ) {
        throw rejectModule()
      }
      if (
        token.moduleTopLevel &&
        token.value === 'export' &&
        !(tokens[index - 1]?.type === 'punctuator' && ['.', '?.'].includes(tokens[index - 1].value))
      ) {
        sawExport = true
        exportStatement = true
      } else if (
        token.moduleTopLevel &&
        exportStatement &&
        token.value === 'from' &&
        tokens[index + 1]?.type === 'literal' &&
        typeof tokens[index + 1].value === 'string'
      ) {
        throw rejectModule()
      }
    }
    if (token.moduleTopLevel && token.type === 'punctuator' && token.value === ';') exportStatement = false
  }
  if (!sawExport) throw rejectModule()
  const delimiters = []
  const closingDelimiter = { ')': '(', ']': '[', '}': '{' }
  for (const token of tokens) {
    if (token.type !== 'punctuator') continue
    if (['(', '[', '{'].includes(token.value)) delimiters.push(token.value)
    else if (Object.hasOwn(closingDelimiter, token.value) && delimiters.pop() !== closingDelimiter[token.value]) {
      throw rejectModule()
    }
  }
  if (delimiters.length > 0) throw rejectModule()
  validateComputedProperties(tokens)
}

export const validateBundledEsm = source => {
  if (typeof source !== 'string') throw rejectModule()
  validateModuleTokens(new ModuleLexer(source).scan())
}
