import type { FormulaAstNode } from './contracts/native-v1/types'

/** Visible slot marker used by the authoring templates. It is never persisted. */
export const FORMULA_SLOT = '□'

const MAX_LINEAR_SOURCE_LENGTH = 16_384
const MAX_PARSE_DEPTH = 48

const GREEK_COMMANDS: Readonly<Record<string, string>> = {
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  epsilon: 'ε',
  theta: 'θ',
  lambda: 'λ',
  mu: 'μ',
  pi: 'π',
  rho: 'ρ',
  sigma: 'σ',
  phi: 'φ',
  omega: 'ω',
  Gamma: 'Γ',
  Delta: 'Δ',
  Theta: 'Θ',
  Lambda: 'Λ',
  Pi: 'Π',
  Sigma: 'Σ',
  Phi: 'Φ',
  Omega: 'Ω',
  infty: '∞',
}

const OPERATOR_COMMANDS: Readonly<Record<string, string>> = {
  times: '×',
  cdot: '·',
  div: '÷',
  pm: '±',
  mp: '∓',
  le: '≤',
  leq: '≤',
  ge: '≥',
  geq: '≥',
  ne: '≠',
  neq: '≠',
  approx: '≈',
  propto: '∝',
  in: '∈',
  notin: '∉',
  sum: '∑',
  prod: '∏',
  int: '∫',
  to: '→',
  leftarrow: '←',
  leftrightarrow: '↔',
}

const ASCII_OPERATOR_ALIASES: Readonly<Record<string, string>> = {
  '<=': '≤',
  '>=': '≥',
  '!=': '≠',
  '->': '→',
  '<-': '←',
}

const SINGLE_OPERATORS = new Set(Array.from(
  '+-*−±∓×·÷=≠<>≤≥≈∝→←↔∈∉∑∏∫,:;!%',
))

const VULGAR_FRACTIONS = new Set(Array.from('¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞'))

const SUPERSCRIPT_DIGITS: Readonly<Record<string, string>> = {
  '⁰': '0',
  '¹': '1',
  '²': '2',
  '³': '3',
  '⁴': '4',
  '⁵': '5',
  '⁶': '6',
  '⁷': '7',
  '⁸': '8',
  '⁹': '9',
}

export class FormulaLinearParseError extends Error {
  readonly position: number

  constructor(message: string, position: number) {
    super(message)
    this.name = 'FormulaLinearParseError'
    this.position = position
  }
}

type StopToken = ')' | ']' | '}' | '\\}' | null

function rowOrSingle(children: FormulaAstNode[]): FormulaAstNode {
  if (children.length === 1) return children[0]!
  return { type: 'row', children }
}

class FormulaLinearParser {
  private index = 0
  private depth = 0

  constructor(private readonly source: string) {}

  parse(): FormulaAstNode {
    if (this.source.length > MAX_LINEAR_SOURCE_LENGTH) {
      throw new FormulaLinearParseError(
        `线性公式最多包含 ${MAX_LINEAR_SOURCE_LENGTH} 个字符`,
        MAX_LINEAR_SOURCE_LENGTH,
      )
    }
    this.skipWhitespace()
    if (this.atEnd()) {
      throw this.error('请输入公式内容')
    }
    const ast = this.parseSequence(null)
    this.skipWhitespace()
    if (!this.atEnd()) {
      throw this.error(`无法识别的内容“${this.source[this.index]}”`)
    }
    return ast
  }

  private parseSequence(stop: StopToken): FormulaAstNode {
    const children: FormulaAstNode[] = []
    while (true) {
      this.skipWhitespace()
      if (this.atStop(stop) || this.atEnd()) break

      const character = this.source[this.index]!
      if (character === ')' || character === ']' || character === '}') {
        throw this.error(`缺少与“${character}”对应的左括号`)
      }
      if (this.source.startsWith('\\}', this.index)) {
        throw this.error('缺少与“\\}”对应的左大括号')
      }
      if (character === '/') {
        if (children.length === 0 || children.at(-1)?.type === 'operator') {
          throw this.error('分数线前需要分子')
        }
        this.index += 1
        this.skipWhitespace()
        if (this.atEnd() || this.atStop(stop)) {
          throw this.error('分数线后需要分母')
        }
        const numerator = children.pop()!
        const denominator = this.parseAtomWithScripts()
        children.push({ type: 'fraction', numerator, denominator })
        continue
      }
      const operator = this.readOperator()
      if (operator !== null) {
        children.push({ type: 'operator', value: operator })
        continue
      }
      children.push(this.parseAtomWithScripts())
    }

    if (children.length === 0) {
      throw this.error('公式结构不能为空')
    }
    return rowOrSingle(children)
  }

  private parseAtomWithScripts(): FormulaAstNode {
    let base = this.parsePrimary()
    let superscript: FormulaAstNode | undefined
    let subscript: FormulaAstNode | undefined

    while (true) {
      this.skipWhitespace()
      const character = this.source[this.index]
      if (character === '^' || character === '_') {
        this.index += 1
        const value = this.parseScriptArgument(character === '^' ? '上标' : '下标')
        if (character === '^') {
          if (superscript) throw this.error('同一基底不能重复设置上标')
          superscript = value
        } else {
          if (subscript) throw this.error('同一基底不能重复设置下标')
          subscript = value
        }
        continue
      }

      let superscriptDigits = ''
      while (this.source[this.index] && SUPERSCRIPT_DIGITS[this.source[this.index]!]) {
        superscriptDigits += SUPERSCRIPT_DIGITS[this.source[this.index]!]!
        this.index += 1
      }
      if (superscriptDigits) {
        if (superscript) throw this.error('同一基底不能重复设置上标')
        superscript = { type: 'token', value: superscriptDigits }
        continue
      }
      break
    }

    if (superscript || subscript) {
      base = {
        type: 'script',
        base,
        ...(superscript ? { superscript } : {}),
        ...(subscript ? { subscript } : {}),
      }
    }
    return base
  }

  private parseScriptArgument(label: string): FormulaAstNode {
    this.skipWhitespace()
    if (this.atEnd()) throw this.error(`${label}不能为空`)
    if (this.source[this.index] === '{') return this.parseGroup()
    return this.parsePrimary()
  }

  private parsePrimary(): FormulaAstNode {
    this.skipWhitespace()
    const character = this.source[this.index]
    if (!character) throw this.error('公式意外结束')
    if (VULGAR_FRACTIONS.has(character)) {
      throw this.error('请使用 a/b 或“分式”模板创建可编辑的竖式分数')
    }
    if (character === '(') return this.parseFence('(', ')')
    if (character === '[') return this.parseFence('[', ']')
    if (character === '{') return this.parseGroup()
    if (character === '\\') return this.parseCommand()
    if (character === '√') {
      this.index += 1
      this.skipWhitespace()
      if (this.atEnd()) throw this.error('根号后需要被开方数')
      return this.withDepth(() => ({
        type: 'root',
        radicand: this.source[this.index] === '{'
          ? this.parseGroup()
          : this.parseAtomWithScripts(),
      }))
    }
    if (character === FORMULA_SLOT) {
      this.index += 1
      return { type: 'token', value: FORMULA_SLOT }
    }
    if (character === '^' || character === '_') {
      throw this.error(`${character === '^' ? '上标' : '下标'}前需要基底`)
    }
    return { type: 'token', value: this.readToken() }
  }

  private parseFence(open: '(' | '[', close: ')' | ']'): FormulaAstNode {
    this.index += 1
    return this.withDepth(() => {
      const body = this.parseSequence(close)
      this.consumeStop(close, `缺少右括号“${close}”`)
      return { type: 'fenced', open, close, body }
    })
  }

  private parseGroup(): FormulaAstNode {
    if (this.source[this.index] !== '{') throw this.error('需要“{”')
    this.index += 1
    return this.withDepth(() => {
      const value = this.parseSequence('}')
      this.consumeStop('}', '缺少右大括号“}”')
      return value
    })
  }

  private parseCommand(): FormulaAstNode {
    const commandPosition = this.index
    this.index += 1
    const next = this.source[this.index]
    if (!next) throw this.error('反斜杠后需要公式命令')

    if (next === '{') {
      this.index += 1
      return this.withDepth(() => {
        const body = this.parseSequence('\\}')
        this.consumeStop('\\}', '缺少右大括号“\\}”')
        return { type: 'fenced', open: '{', close: '}', body }
      })
    }
    if (next === '}' || next === '\\' || next === '_' || next === '^') {
      this.index += 1
      return { type: 'token', value: next }
    }

    const name = this.readCommandName()
    const greek = GREEK_COMMANDS[name]
    if (greek) return { type: 'token', value: greek }
    const operator = OPERATOR_COMMANDS[name]
    if (operator) return { type: 'operator', value: operator }

    switch (name) {
      case 'frac':
        return this.withDepth(() => ({
          type: 'fraction',
          numerator: this.parseRequiredGroup('分子'),
          denominator: this.parseRequiredGroup('分母'),
        }))
      case 'sqrt':
        return this.withDepth(() => {
          this.skipWhitespace()
          let index: FormulaAstNode | undefined
          if (this.source[this.index] === '[') {
            this.index += 1
            index = this.parseSequence(']')
            this.consumeStop(']', '根式次数缺少“]”')
          }
          const radicand = this.parseRequiredGroup('被开方数')
          return {
            type: 'root',
            radicand,
            ...(index ? { index } : {}),
          }
        })
      case 'root':
        return this.withDepth(() => ({
          type: 'root',
          index: this.parseRequiredGroup('根式次数'),
          radicand: this.parseRequiredGroup('被开方数'),
        }))
      case 'row': {
        const value = this.parseRequiredGroup('行内容')
        return value.type === 'row'
          ? value
          : { type: 'row', children: [value] }
      }
      case 'text':
        return { type: 'token', value: this.readRawGroup('文本') }
      case 'operator':
        return { type: 'operator', value: this.readRawGroup('运算符') }
      case 'abs':
        return {
          type: 'fenced',
          open: '|',
          close: '|',
          body: this.parseRequiredGroup('绝对值内容'),
        }
      case 'fenced': {
        const open = this.readRawGroup('左围栏')
        const close = this.readRawGroup('右围栏')
        const body = this.parseRequiredGroup('围栏内容')
        return { type: 'fenced', open, close, body }
      }
      default:
        throw new FormulaLinearParseError(
          `不支持的命令“\\${name}”`,
          commandPosition,
        )
    }
  }

  private parseRequiredGroup(label: string): FormulaAstNode {
    this.skipWhitespace()
    if (this.source[this.index] !== '{') {
      throw this.error(`${label}需要放在 { } 中`)
    }
    return this.parseGroup()
  }

  private readRawGroup(label: string): string {
    this.skipWhitespace()
    if (this.source[this.index] !== '{') {
      throw this.error(`${label}需要放在 { } 中`)
    }
    this.index += 1
    let value = ''
    while (!this.atEnd()) {
      const character = this.source[this.index]!
      if (character === '}') {
        this.index += 1
        if (!value) throw this.error(`${label}不能为空`)
        return value
      }
      if (character === '\\') {
        const escaped = this.source[this.index + 1]
        if (escaped === '{' || escaped === '}' || escaped === '\\') {
          value += escaped
          this.index += 2
          continue
        }
      }
      value += character
      this.index += 1
    }
    throw this.error(`${label}缺少右大括号“}”`)
  }

  private readCommandName(): string {
    const start = this.index
    while (/[A-Za-z]/u.test(this.source[this.index] ?? '')) this.index += 1
    if (this.index === start) {
      throw this.error(`无法识别的转义“\\${this.source[this.index] ?? ''}”`)
    }
    return this.source.slice(start, this.index)
  }

  private readToken(): string {
    const start = this.index
    while (!this.atEnd()) {
      const character = this.source[this.index]!
      if (
        /\s/u.test(character) ||
        character === '\\' ||
        character === '/' ||
        character === '^' ||
        character === '_' ||
        character === '(' ||
        character === ')' ||
        character === '[' ||
        character === ']' ||
        character === '{' ||
        character === '}' ||
        character === '√' ||
        character === FORMULA_SLOT ||
        VULGAR_FRACTIONS.has(character) ||
        SINGLE_OPERATORS.has(character) ||
        SUPERSCRIPT_DIGITS[character]
      ) {
        break
      }
      this.index += 1
    }
    if (this.index === start) {
      throw this.error(`无法识别的内容“${this.source[this.index]}”`)
    }
    return this.source.slice(start, this.index)
  }

  private readOperator(): string | null {
    const pair = this.source.slice(this.index, this.index + 2)
    const alias = ASCII_OPERATOR_ALIASES[pair]
    if (alias) {
      this.index += 2
      return alias
    }
    const character = this.source[this.index]
    if (character && SINGLE_OPERATORS.has(character)) {
      this.index += 1
      return character
    }
    return null
  }

  private consumeStop(stop: Exclude<StopToken, null>, message: string): void {
    this.skipWhitespace()
    if (!this.atStop(stop)) throw this.error(message)
    this.index += stop.length
  }

  private atStop(stop: StopToken): boolean {
    if (stop === null) return false
    return this.source.startsWith(stop, this.index)
  }

  private withDepth<T>(read: () => T): T {
    this.depth += 1
    if (this.depth > MAX_PARSE_DEPTH) {
      throw this.error(`公式嵌套最多支持 ${MAX_PARSE_DEPTH} 层`)
    }
    try {
      return read()
    } finally {
      this.depth -= 1
    }
  }

  private skipWhitespace(): void {
    while (/\s/u.test(this.source[this.index] ?? '')) this.index += 1
  }

  private atEnd(): boolean {
    return this.index >= this.source.length
  }

  private error(message: string): FormulaLinearParseError {
    return new FormulaLinearParseError(message, this.index)
  }
}

/** Parse the deliberately limited, offline linear authoring syntax into V8 AST. */
export function parseFormulaLinear(source: string): FormulaAstNode {
  return new FormulaLinearParser(source).parse()
}

function escapeRaw(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('{', '\\{')
    .replaceAll('}', '\\}')
}

function safeToken(value: string): boolean {
  return value === FORMULA_SLOT || (
    /^[\p{L}\p{N}.]+$/u.test(value) &&
    Array.from(value).every((character) => (
      !SUPERSCRIPT_DIGITS[character] && !VULGAR_FRACTIONS.has(character)
    ))
  )
}

function serializeNode(ast: FormulaAstNode, topLevel = false): string {
  switch (ast.type) {
    case 'token':
      return safeToken(ast.value) ? ast.value : `\\text{${escapeRaw(ast.value)}}`
    case 'operator':
      return ast.value !== '/' && (
        SINGLE_OPERATORS.has(ast.value) || Object.values(OPERATOR_COMMANDS).includes(ast.value)
      )
        ? ast.value
        : `\\operator{${escapeRaw(ast.value)}}`
    case 'row': {
      const content = ast.children.map((child) => serializeNode(child)).join(' ')
      return topLevel && ast.children.length > 1 ? content : `\\row{${content}}`
    }
    case 'fraction':
      return `\\frac{${serializeNode(ast.numerator)}}{${serializeNode(ast.denominator)}}`
    case 'root':
      return ast.index
        ? `\\sqrt[${serializeNode(ast.index)}]{${serializeNode(ast.radicand)}}`
        : `\\sqrt{${serializeNode(ast.radicand)}}`
    case 'script': {
      const base = serializeNode(ast.base)
      const subscript = ast.subscript ? `_{${serializeNode(ast.subscript)}}` : ''
      const superscript = ast.superscript ? `^{${serializeNode(ast.superscript)}}` : ''
      return `${base}${subscript}${superscript}`
    }
    case 'fenced': {
      const body = serializeNode(ast.body)
      if (ast.open === '(' && ast.close === ')') return `(${body})`
      if (ast.open === '[' && ast.close === ']') return `[${body}]`
      if (ast.open === '{' && ast.close === '}') return `\\{${body}\\}`
      if (ast.open === '|' && ast.close === '|') return `\\abs{${body}}`
      return `\\fenced{${escapeRaw(ast.open)}}{${escapeRaw(ast.close)}}{${body}}`
    }
  }
}

/**
 * Serialize every legal V8 formula node without inventing a second persisted
 * source. Explicit escape commands preserve uncommon token/operator/fence data.
 */
export function serializeFormulaAst(ast: FormulaAstNode): string {
  return serializeNode(ast, true)
}

const DIGIT_WORDS: Readonly<Record<string, string>> = {
  '0': '零',
  '1': '一',
  '2': '二',
  '3': '三',
  '4': '四',
  '5': '五',
  '6': '六',
  '7': '七',
  '8': '八',
  '9': '九',
  '10': '十',
}

const TOKEN_SPEECH: Readonly<Record<string, string>> = {
  'α': '阿尔法',
  'β': '贝塔',
  'γ': '伽马',
  'δ': '德尔塔',
  'θ': '西塔',
  'λ': '兰布达',
  'μ': '缪',
  'π': '圆周率',
  'σ': '西格玛',
  'φ': '斐',
  'ω': '欧米伽',
  '∞': '无穷大',
}

const OPERATOR_SPEECH: Readonly<Record<string, string>> = {
  '+': '加',
  '-': '减',
  '−': '减',
  '*': '乘',
  '×': '乘',
  '·': '乘',
  '÷': '除以',
  '±': '正负',
  '∓': '负正',
  '=': '等于',
  '≠': '不等于',
  '<': '小于',
  '>': '大于',
  '≤': '小于或等于',
  '≥': '大于或等于',
  '≈': '约等于',
  '∝': '正比于',
  '∈': '属于',
  '∉': '不属于',
  '∑': '求和',
  '∏': '求积',
  '∫': '积分',
  '→': '趋向',
  '←': '反向趋向',
  '↔': '等价于',
  ',': '，',
  ';': '；',
  ':': '：',
}

function accessibleToken(value: string): string {
  return DIGIT_WORDS[value] ?? TOKEN_SPEECH[value] ?? value
}

/** Derive a human-readable default; authors may still keep an explicit override. */
export function formulaAstToAccessibleText(ast: FormulaAstNode): string {
  switch (ast.type) {
    case 'token':
      return accessibleToken(ast.value)
    case 'operator':
      return OPERATOR_SPEECH[ast.value] ?? ast.value
    case 'row':
      return ast.children.map(formulaAstToAccessibleText).join('')
    case 'fraction':
      return `${formulaAstToAccessibleText(ast.denominator)}分之${formulaAstToAccessibleText(ast.numerator)}`
    case 'root':
      return ast.index
        ? `${formulaAstToAccessibleText(ast.index)}次根号下${formulaAstToAccessibleText(ast.radicand)}`
        : `${formulaAstToAccessibleText(ast.radicand)}的平方根`
    case 'script': {
      const base = formulaAstToAccessibleText(ast.base)
      const subscript = ast.subscript
        ? `下标${formulaAstToAccessibleText(ast.subscript)}`
        : ''
      const superscriptValue = ast.superscript
        ? formulaAstToAccessibleText(ast.superscript)
        : ''
      const superscript = superscriptValue === '二'
        ? ' 的平方'
        : superscriptValue === '三'
          ? ' 的立方'
          : superscriptValue
            ? ` 的上标${superscriptValue}`
            : ''
      return `${base}${subscript}${superscript}`
    }
    case 'fenced': {
      const body = formulaAstToAccessibleText(ast.body)
      if (ast.open === '(' && ast.close === ')') return `括号内${body}`
      if (ast.open === '[' && ast.close === ']') return `方括号内${body}`
      if (ast.open === '{' && ast.close === '}') return `大括号内${body}`
      if (ast.open === '|' && ast.close === '|') return `${body}的绝对值`
      return `${ast.open}${body}${ast.close}`
    }
  }
}

export function formulaAstContainsSlot(ast: FormulaAstNode): boolean {
  switch (ast.type) {
    case 'token':
      return ast.value.includes(FORMULA_SLOT)
    case 'operator':
      return false
    case 'row':
      return ast.children.some(formulaAstContainsSlot)
    case 'fraction':
      return formulaAstContainsSlot(ast.numerator) || formulaAstContainsSlot(ast.denominator)
    case 'root':
      return formulaAstContainsSlot(ast.radicand) || (
        ast.index ? formulaAstContainsSlot(ast.index) : false
      )
    case 'script':
      return formulaAstContainsSlot(ast.base) || (
        ast.superscript ? formulaAstContainsSlot(ast.superscript) : false
      ) || (
        ast.subscript ? formulaAstContainsSlot(ast.subscript) : false
      )
    case 'fenced':
      return formulaAstContainsSlot(ast.body)
  }
}

export interface FormulaTemplateInsertion {
  value: string
  selectionStart: number
  selectionEnd: number
}

/** Insert a template while preserving a selected expression as its first slot. */
export function insertFormulaTemplate(
  source: string,
  selectionStart: number,
  selectionEnd: number,
  template: string,
  selectedSlotIndex = 0,
): FormulaTemplateInsertion {
  const start = Math.max(0, Math.min(source.length, selectionStart))
  const end = Math.max(start, Math.min(source.length, selectionEnd))
  const selected = source.slice(start, end)
  let selectedSlot = -1
  let searchFrom = 0
  for (let index = 0; index <= selectedSlotIndex; index += 1) {
    selectedSlot = template.indexOf(FORMULA_SLOT, searchFrom)
    if (selectedSlot < 0) break
    searchFrom = selectedSlot + FORMULA_SLOT.length
  }
  const filled = selected && selectedSlot >= 0
    ? `${template.slice(0, selectedSlot)}${selected}${template.slice(selectedSlot + FORMULA_SLOT.length)}`
    : template
  const value = `${source.slice(0, start)}${filled}${source.slice(end)}`
  const nextSlot = filled.indexOf(FORMULA_SLOT)
  if (nextSlot >= 0) {
    const slotStart = start + nextSlot
    return {
      value,
      selectionStart: slotStart,
      selectionEnd: slotStart + FORMULA_SLOT.length,
    }
  }
  const caret = start + filled.length
  return { value, selectionStart: caret, selectionEnd: caret }
}
