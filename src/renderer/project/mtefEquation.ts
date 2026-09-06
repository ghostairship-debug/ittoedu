import type { FormulaAstNode } from '../../shared/contracts/native-v1'
import { formulaAstSchema } from '../../shared/contracts/native-v1/schema'

/** Read-only MTEF 3/5 subset. Record layouts follow the MathType SDK MTEF spec.
 * No OLE activation, translator executable, or source display image is involved.
 * Unknown semantic records reject the object instead of losing equation content.
 */
export function parseMtefEquation(bytes: Uint8Array): { ast: FormulaAstNode; color: string } {
  return new MtefReader(bytes).parse()
}

const row = (children: FormulaAstNode[]): FormulaAstNode => children.length === 1 ? children[0]! : { type: 'row', children }
const operators = new Set(Array.from('+-−×÷=≠<>≤≥±∓≈∝∈∉→←↔∑∏∫·,:;!%'))

class MtefReader {
  private offset = 0
  private version = 0
  private records = 0
  private colors = ['#000000']
  private color = '#000000'
  private usedColors = new Set<string>()

  constructor(private readonly bytes: Uint8Array) {}

  private fail(message: string): never { throw new Error(`MTEF ${this.version || '?'} @${this.offset}: ${message}`) }
  private byte(): number {
    if (this.offset >= this.bytes.length) this.fail('公式数据被截断')
    return this.bytes[this.offset++]!
  }
  private word(): number { return this.byte() | this.byte() << 8 }
  private uint(): number { const n = this.byte(); return n === 255 ? this.word() : n }
  private string(): void { for (let n = 0; n < 1024; n++) if (this.byte() === 0) return; this.fail('字体或编码名称过长') }
  private nudge(options: number): void {
    if (!(options & 8)) return
    const x = this.byte(), y = this.byte()
    const moved = x === 128 && y === 128 ? this.word() !== 0 || this.word() !== 0 : x !== 0 || y !== 0
    if (moved) this.fail('暂不支持手工偏移的公式字符或模板')
  }

  parse(): { ast: FormulaAstNode; color: string } {
    if (this.bytes.length > 65_536) this.fail('公式数据超过 64 KiB')
    this.version = this.byte()
    if (this.version !== 3 && this.version !== 5) this.fail('暂不支持此公式版本')
    for (let i = 0; i < 4; i++) this.byte() // platform, product, version, subversion
    if (this.version === 5) { this.string(); this.byte() }
    const ast = row(this.list(0))
    if (ast.type === 'row' && !ast.children.length) this.fail('公式内容为空')
    while (this.offset < this.bytes.length) if (this.byte() !== 0) this.fail('结束标记之后存在未解析数据')
    if (this.usedColors.size > 1) this.fail('当前 Native 公式不支持同一公式内的多色字符')
    return { ast: formulaAstSchema.parse(ast), color: [...this.usedColors][0] ?? '#000000' }
  }

  private list(depth: number): FormulaAstNode[] {
    if (depth > 32) this.fail('公式嵌套过深')
    const nodes: FormulaAstNode[] = []
    while (true) {
      if (++this.records > 4096) this.fail('公式记录过多')
      const tag = this.byte(), type = this.version === 3 ? tag & 15 : tag
      if (type === 0) return nodes
      const options = this.version === 3 ? tag >> 4 : [1, 2, 3].includes(type) ? this.byte() : 0
      if (type === 1) {
        if (options & ~9) this.fail('暂不支持行距或标尺设置')
        this.nudge(options)
        nodes.push(row(options & 1 ? [] : this.list(depth + 1)))
      } else if (type === 2) {
        if (options & ~0x3e || options & 0x20) this.fail('暂不支持修饰字符或缺少 Unicode 的字符')
        this.nudge(options)
        this.byte() // typeface: Unicode is authoritative; the Native renderer owns fonts
        const code = this.word()
        if (this.version === 5) {
          if (options & 4) this.byte()
          else if (options & 16) this.word()
        }
        if (code < 32 || code >= 0xd800 && code <= 0xf8ff || code === 0xffff || code === 0xfffe) this.fail(`暂不支持字符 U+${code.toString(16).toUpperCase()}`)
        const value = String.fromCharCode(code)
        this.usedColors.add(this.color)
        nodes.push({ type: operators.has(value) ? 'operator' : 'token', value })
      } else if (type === 3) {
        if (options & ~8) this.fail('未知模板选项')
        this.nudge(options)
        const selector = this.byte()
        let variation = this.byte()
        if (this.version === 5 && variation & 128) variation = (variation & 127) | this.byte() << 8
        if (this.byte() !== 0) this.fail('暂不支持模板特殊对齐')
        const slots = this.list(depth + 1)
        if (selector === (this.version === 5 ? 11 : 14) && variation === 0) {
          if (slots.length !== 2 || slots.some(s => s.type === 'row' && !s.children.length)) this.fail('分数需要分子与分母')
          nodes.push({ type: 'fraction', numerator: slots[0]!, denominator: slots[1]! })
        } else if (this.version === 5 && [27, 28, 29].includes(selector) && variation === 0 || this.version === 3 && selector === 15 && variation <= 2) {
          const kind = this.version === 5 ? selector : [28, 27, 29][variation]!
          const base = nodes.pop()
          if (!base || slots.length !== 2) this.fail('上下标缺少基底或插槽')
          const subscript = slots[0]!, superscript = slots[1]!
          const empty = (node: FormulaAstNode) => node.type === 'row' && !node.children.length
          if (kind === 28 && !empty(subscript) || kind === 27 && !empty(superscript) || kind !== 28 && empty(subscript) || kind !== 27 && empty(superscript)) this.fail('上下标插槽与模板不匹配')
          nodes.push({ type: 'script', base, ...(kind !== 28 ? { subscript } : {}), ...(kind !== 27 ? { superscript } : {}) })
        } else this.fail(`暂不支持模板 ${selector} / ${variation}`)
      } else this.metadata(type, options)
    }
  }

  private metadata(type: number, options: number): void {
    if (type >= 10 && type <= 14) return // logical full/sub/symbol size; AST controls relative layout
    if (type === 8 && this.version === 3) { this.byte(); this.byte(); this.string(); return }
    if (type === 9) {
      const selector = this.byte()
      if (selector === 101) this.word()
      else if (selector === 100) { this.byte(); this.word() }
      else this.byte()
      return
    }
    if (this.version === 5) {
      if (type === 8) { this.uint(); this.byte(); return }
      if (type === 15) {
        const index = this.uint()
        if (!this.colors[index]) this.fail('颜色索引不存在')
        this.color = this.colors[index]!
        return
      }
      if (type === 16) {
        const flags = this.byte()
        if (flags & ~4) this.fail('暂不支持 CMYK 或专色公式')
        const rgb = [this.word(), this.word(), this.word()]
        if (rgb.some(value => value > 1000)) this.fail('颜色分量无效')
        this.colors.push(`#${rgb.map(value => Math.round(value * 255 / 1000).toString(16).padStart(2, '0')).join('')}`)
        if (flags & 4) this.string()
        return
      }
      if (type === 17) { this.uint(); this.string(); return }
      if (type === 19) { this.string(); return }
      if (type === 18) {
        if (this.byte() !== 0) this.fail('未知公式首选项')
        for (let block = 0; block < 2; block++) {
          const count = this.byte()
          let nibble = this.offset * 2
          for (let entry = 0; entry < count; entry++) {
            let ended = false
            for (let digit = 0; digit < 32; digit++) {
              const value = this.bytes[Math.floor(nibble / 2)]
              if (value === undefined) this.fail('公式首选项被截断')
              const part = value >> (nibble++ % 2 ? 0 : 4) & 15
              if (part === 15) { ended = true; break }
            }
            if (!ended) this.fail('公式首选项数值过长')
          }
          this.offset = Math.ceil(nibble / 2)
        }
        const styles = this.byte()
        for (let i = 0; i < styles; i++) if (this.byte() !== 0) this.byte()
        return
      }
    }
    this.fail(`暂不支持记录 ${type} / ${options}`)
  }
}
