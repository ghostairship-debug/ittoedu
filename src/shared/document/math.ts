/** Finite LaTeX grammar for shared documents. Trees are derived, never persisted. */
export type MathNode =
  | { type: 'row'; children: MathNode[] }
  | { type: 'symbol'; value: string }
  | { type: 'text'; value: string }
  | { type: 'roman'; body: MathNode }
  | { type: 'fraction'; numerator: MathNode; denominator: MathNode }
  | { type: 'root'; body: MathNode; degree?: MathNode }
  | { type: 'scripts'; base: MathNode; sub?: MathNode; sup?: MathNode }
  | { type: 'nary'; operator: '∑' | '∏' | '∫'; body: MathNode; sub?: MathNode; sup?: MathNode; limits?: boolean }
  | { type: 'delimiter'; left: string; right: string; body: MathNode }
  | { type: 'aligned' | 'cases' | 'matrix'; rows: MathNode[][] }

export const MATH_SYMBOLS: Readonly<Record<string, string>> = Object.freeze({
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', theta: 'θ', lambda: 'λ',
  mu: 'μ', pi: 'π', rho: 'ρ', sigma: 'σ', phi: 'φ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ',
  Theta: 'Θ', Lambda: 'Λ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Omega: 'Ω', infty: '∞',
  times: '×', cdot: '·', div: '÷', pm: '±', mp: '∓', le: '≤', leq: '≤', ge: '≥', geq: '≥',
  ne: '≠', neq: '≠', approx: '≈', propto: '∝', in: '∈', notin: '∉', to: '→',
  leftarrow: '←', leftrightarrow: '↔',
})
export const MATH_FUNCTIONS = ['sin', 'cos', 'tan', 'cot', 'sec', 'csc', 'log', 'ln', 'exp', 'lim', 'min', 'max'] as const
export const MATH_STRUCTURES = ['frac', 'sqrt', 'text', 'mathrm', 'sum', 'prod', 'int', 'limits', 'nolimits', 'left', 'right', 'begin', 'end'] as const

export class DocumentMathError extends Error {
  constructor(message: string, readonly offset: number) { super(message); this.name = 'DocumentMathError' }
}
const row = (children: MathNode[]): MathNode => children.length === 1 ? children[0]! : { type: 'row', children }
const symbol = (value: string): MathNode => ({ type: 'symbol', value })
const relations = new Set('=<>≤≥≠≈∝∈∉→←↔,:;')

class Parser {
  private i = 0
  private depth = 0
  private environment = false
  constructor(private source: string) {}
  private fail(message: string): never { throw new DocumentMathError(message, this.i) }
  private skip() { while (/\s/.test(this.source[this.i] ?? '') && this.i < this.source.length) this.i++ }
  private at(value: string) { return this.source.startsWith(value, this.i) }
  private expect(value: string) { if (!this.at(value)) this.fail(`需要 ${value}`); this.i += value.length }
  private command(): string {
    this.expect('\\')
    const match = /^[a-zA-Z]+|./s.exec(this.source.slice(this.i))
    if (!match) this.fail('未完成的命令')
    this.i += match[0].length
    return match[0]
  }
  parse(): MathNode {
    if (this.source.length > 16384) this.fail('公式超过 16384 个字符')
    this.skip()
    if (!this.source.slice(this.i)) this.fail('请输入公式')
    const result = this.sequence(() => false)
    if (this.i !== this.source.length) this.fail('多余的公式边界')
    return result
  }
  private sequence(stop: () => boolean, term = false): MathNode {
    const nodes: MathNode[] = []
    while (true) {
      this.skip()
      if (this.i === this.source.length || stop()) break
      if (term && this.termBoundary(nodes.length > 0)) break
      nodes.push(this.atom())
    }
    return row(nodes)
  }
  private termBoundary(hasFactor: boolean): boolean {
    const c = this.source[this.i]!
    if ('}&'.includes(c) || this.at('\\\\') || this.at('\\end') || this.at('\\right')) return true
    const command = /^\\([a-zA-Z]+)/.exec(this.source.slice(this.i))?.[1]
    const mapped = command ? MATH_SYMBOLS[command] : c
    if (mapped && relations.has(mapped)) return true
    return hasFactor && ['+', '-', '−', '±', '∓'].includes(mapped ?? c)
  }
  private group(open = '{', close = '}'): MathNode {
    this.skip(); this.expect(open)
    const result = this.sequence(() => this.at(close))
    this.expect(close)
    return result
  }
  private argument(): MathNode {
    this.skip()
    if (this.at('{')) return this.group()
    // A TeX script without braces consumes one atom, not its following script.
    return this.base()
  }
  private scripts(): { sub?: MathNode; sup?: MathNode } {
    const result: { sub?: MathNode; sup?: MathNode } = {}
    for (;;) {
      this.skip()
      const c = this.source[this.i]
      if (c !== '_' && c !== '^') return result
      this.i++
      const key = c === '_' ? 'sub' : 'sup'
      if (result[key]) this.fail('重复的上标或下标')
      result[key] = this.argument()
    }
  }
  private atom(): MathNode {
    if (++this.depth > 48) this.fail('公式嵌套超过 48 层')
    try {
      const base = this.base()
      const scripts = this.scripts()
      return scripts.sub || scripts.sup ? { type: 'scripts', base, ...scripts } : base
    } finally { this.depth-- }
  }
  private base(): MathNode {
    this.skip()
    const c = this.source[this.i]
    if (!c || '{}^_&$'.includes(c) && c !== '{') this.fail('缺少公式项或出现未配对边界')
    if (c === '{') return this.group()
    if (c !== '\\') {
      if (!/[a-zA-Z0-9+\-*/=<>()[\].,;:!|%−±∓×·÷≤≥≠≈∝→←↔∈∉α-ωΑ-Ω∞]/u.test(c)) this.fail('不支持的字符，普通文字请放入 \\text')
      this.i++
      return symbol(c)
    }
    const start = this.i
    const name = this.command()
    if (MATH_SYMBOLS[name]) return symbol(MATH_SYMBOLS[name]!)
    if ((MATH_FUNCTIONS as readonly string[]).includes(name)) return { type: 'roman', body: symbol(name) }
    if ([',', ';', ':', ' ', 'quad', 'qquad', '!'].includes(name)) return symbol(name === '!' ? '' : name === 'qquad' ? '\u2003\u2003' : name === 'quad' ? '\u2003' : '\u2009')
    if (['{', '}', '%', '_', '$', '|'].includes(name)) return symbol(name)
    if (name === 'frac') return { type: 'fraction', numerator: this.group(), denominator: this.group() }
    if (name === 'sqrt') {
      this.skip()
      const degree = this.at('[') ? this.group('[', ']') : undefined
      return { type: 'root', body: this.group(), ...(degree ? { degree } : {}) }
    }
    if (name === 'text') {
      this.skip(); this.expect('{')
      let value = ''
      while (this.i < this.source.length && !this.at('}')) {
        if (this.at('{')) this.fail('普通文字中花括号须转义')
        if (this.at('\\')) {
          const escaped = this.command()
          if (!['{', '}', '\\', '%', '$', '_', '&', '#', ' '].includes(escaped)) this.fail('普通文字中不支持该命令')
          value += escaped
        } else value += this.source[this.i++]
      }
      this.expect('}')
      return { type: 'text', value }
    }
    if (name === 'mathrm') return { type: 'roman', body: this.group() }
    if (['sum', 'prod', 'int'].includes(name)) {
      this.skip()
      let limits: boolean | undefined
      const takeLimits = () => {
        this.skip()
        if (this.at('\\limits') || this.at('\\nolimits')) {
          if (limits !== undefined) this.fail('重复的 limits')
          limits = this.command() === 'limits'
        }
      }
      takeLimits()
      const scripts = this.scripts()
      takeLimits(); this.skip()
      const body = this.at('{') ? this.group() : this.sequence(() => false, true)
      if (body.type === 'row' && !body.children.length) this.fail('求和、乘积或积分缺少操作数')
      return { type: 'nary', operator: name === 'sum' ? '∑' : name === 'prod' ? '∏' : '∫', body, ...scripts, ...(limits === undefined ? {} : { limits }) }
    }
    if (name === 'left') {
      const left = this.delimiter()
      const body = this.sequence(() => this.at('\\right'))
      this.expect('\\right')
      return { type: 'delimiter', left, right: this.delimiter(), body }
    }
    if (name === 'begin') return this.grid()
    this.i = start
    this.fail(`不支持的命令 \\${name}`)
  }
  private delimiter(): string {
    this.skip()
    const c = this.source[this.i++]
    if (c === '\\') {
      this.i--
      const name = this.command()
      const values: Record<string, string> = { '{': '{', '}': '}', langle: '⟨', rangle: '⟩', vert: '|', Vert: '‖', '|': '‖' }
      if (!(name in values)) this.fail('不支持的括号')
      return values[name]!
    }
    if (c && '()[]|.'.includes(c)) return c === '.' ? '' : c
    this.fail('需要括号')
  }
  private grid(): MathNode {
    if (this.environment) this.fail('首期不支持环境嵌套')
    this.expect('{')
    const match = /^(aligned|cases|matrix)}/.exec(this.source.slice(this.i))
    if (!match) this.fail('不支持的数学环境')
    const type = match[1] as 'aligned' | 'cases' | 'matrix'
    this.i += match[0].length
    this.environment = true
    const rows: MathNode[][] = [[]]
    const end = `\\end{${type}}`
    while (true) {
      const cell = this.sequence(() => this.at('&') || this.at('\\\\') || this.at('\\end'))
      rows[rows.length - 1]!.push(cell)
      if (this.at(end)) { this.i += end.length; break }
      if (this.at('&')) this.i++
      else if (this.at('\\\\')) {
        this.i += 2; this.skip()
        if (this.at('[')) this.fail('首期不支持自定义行距')
        rows.push([])
      } else this.fail('环境未闭合或结束名称不匹配')
    }
    this.environment = false
    const width = type === 'matrix' ? rows[0]!.length : 2
    if (rows.some(cells => cells.length !== width)) this.fail('数学环境列数不符')
    return { type, rows }
  }
}

export function parseDocumentMath(latex: string): MathNode { return new Parser(latex).parse() }

/** Default description, overridden by an explicitly edited accessibleText. */
export function describeDocumentMath(node: MathNode): string {
  switch (node.type) {
    case 'row': return node.children.map(describeDocumentMath).join('')
    case 'symbol': case 'text': return node.value
    case 'roman': return describeDocumentMath(node.body)
    case 'fraction': return `分式（${describeDocumentMath(node.numerator)}）除以（${describeDocumentMath(node.denominator)}）`
    case 'root': return `${node.degree ? describeDocumentMath(node.degree) : '平方'}根（${describeDocumentMath(node.body)}）`
    case 'scripts': return describeDocumentMath(node.base) + (node.sub ? `下标（${describeDocumentMath(node.sub)}）` : '') + (node.sup ? `上标（${describeDocumentMath(node.sup)}）` : '')
    case 'nary': return `${node.operator}${node.sub ? `下限（${describeDocumentMath(node.sub)}）` : ''}${node.sup ? `上限（${describeDocumentMath(node.sup)}）` : ''}（${describeDocumentMath(node.body)}）`
    case 'delimiter': return node.left + describeDocumentMath(node.body) + node.right
    default: return node.rows.map(cells => cells.map(describeDocumentMath).join('，')).join('；')
  }
}
