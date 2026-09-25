import { mutationCallSchema } from '../tools/ToolCatalog'

export interface StreamingEditArgumentsSnapshot {
  readonly target?: string
  readonly content?: string
  /** Complete JSON and schema; only finish() authorizes returning final tool arguments. */
  readonly complete: boolean
}
export interface StreamingEditArgumentsIdentity {
  readonly toolCallId: string
  readonly toolName: 'text.replace'
}
export interface TextReplaceArguments { target: string; content: string }

export class StreamingEditArgumentsError extends Error {
  constructor(readonly toolCallId: string, readonly code: string, message: string) {
    super(message)
    this.name = 'StreamingEditArgumentsError'
  }
}

class ArgumentSyntaxError extends Error {
  constructor(readonly code: string, message: string) { super(message) }
}
const invalid = (code: string, message: string): never => { throw new ArgumentSyntaxError(code, message) }

function validateInput(input: unknown): TextReplaceArguments {
  const parsed = mutationCallSchema.safeParse({ name: 'text.replace', input })
  if (!parsed.success || parsed.data.name !== 'text.replace') return invalid('invalid-schema', '编辑参数不符合正式 text.replace 合同')
  return parsed.data.input
}

/** Emits only decoded, complete Unicode scalar values, including across transport chunks. */
class JsonString {
  value = ''
  private escaped = false
  private hex: string | null = null
  private high: number | null = null

  private unit(code: number): void {
    if (this.high !== null) {
      if (code < 0xdc00 || code > 0xdfff) return invalid('invalid-unicode', 'JSON 字符串含未配对的 Unicode 代理项')
      this.value += String.fromCharCode(this.high, code)
      this.high = null
    } else if (code >= 0xd800 && code <= 0xdbff) this.high = code
    else if (code >= 0xdc00 && code <= 0xdfff) invalid('invalid-unicode', 'JSON 字符串含孤立的 Unicode 低代理项')
    else this.value += String.fromCharCode(code)
  }

  /** Returns true only when the unescaped closing quote has arrived. */
  accept(character: string): boolean {
    if (this.hex !== null) {
      if (!/^[\da-f]$/i.test(character)) return invalid('invalid-escape', 'JSON Unicode 转义必须包含四位十六进制数字')
      this.hex += character
      if (this.hex.length === 4) { this.unit(Number.parseInt(this.hex, 16)); this.hex = null }
      return false
    }
    if (this.escaped) {
      this.escaped = false
      if (character === 'u') { this.hex = ''; return false }
      const escapes: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }
      const decoded = escapes[character]
      if (decoded === undefined) return invalid('invalid-escape', '不支持的 JSON 字符串转义')
      this.unit(decoded.charCodeAt(0))
      return false
    }
    if (character === '"') {
      if (this.high !== null) return invalid('invalid-unicode', 'JSON 字符串在 Unicode 代理对完成前结束')
      return true
    }
    if (character === '\\') { this.escaped = true; return false }
    const code = character.charCodeAt(0)
    if (code < 0x20) return invalid('invalid-string', 'JSON 字符串中的控制字符必须转义')
    this.unit(code)
    return false
  }

  unfinished(): never {
    if (this.high !== null || this.hex !== null) return invalid('incomplete-unicode', '编辑参数以不完整的 Unicode 字符结束')
    if (this.escaped) return invalid('incomplete-escape', '编辑参数以不完整的转义结束')
    return invalid('incomplete-json', '编辑参数字符串尚未结束')
  }
}

/** Narrow incremental JSON grammar: one root object, two unique string-valued fields. */
class ArgumentParser {
  target: string | undefined
  private contentValue: string | undefined
  private phase: 'root' | 'first-key' | 'key' | 'colon' | 'value' | 'separator' | 'done' = 'root'
  private field: 'target' | 'content' | undefined
  private string: JsonString | undefined
  private purpose: 'key' | 'target' | 'content' | undefined
  private seen = new Set<string>()

  get complete(): boolean { return this.phase === 'done' }
  get content(): string | undefined { return this.purpose === 'content' && this.string ? this.string.value : this.contentValue }

  feed(fragment: string): void {
    // Iterate UTF-16 code units; a literal emoji can itself be split across delta strings.
    for (let index = 0; index < fragment.length; index += 1) {
      const character = fragment[index]!
      if (this.string) {
        if (!this.string.accept(character)) continue
        const value = this.string.value, purpose = this.purpose
        this.string = undefined; this.purpose = undefined
        if (purpose === 'key') {
          if (this.seen.has(value)) return invalid('duplicate-key', `编辑参数重复定义 ${value}`)
          if (value !== 'target' && value !== 'content') return invalid('unexpected-field', '编辑参数只允许 target 与 content')
          this.seen.add(value); this.field = value; this.phase = 'colon'
        } else {
          if (purpose === 'target') {
            validateInput({ target: value, content: '' })
            this.target = value
          } else this.contentValue = value
          this.phase = 'separator'
        }
        continue
      }
      if (character === ' ' || character === '\t' || character === '\r' || character === '\n') continue
      if (this.phase === 'root') {
        if (character !== '{') return invalid('invalid-root', '编辑参数必须是 JSON 对象')
        this.phase = 'first-key'
      } else if (this.phase === 'first-key' || this.phase === 'key') {
        if (character !== '"') return invalid('invalid-key', '编辑参数必须包含 target 与 content 字符串字段')
        this.string = new JsonString(); this.purpose = 'key'
      } else if (this.phase === 'colon') {
        if (character !== ':') return invalid('invalid-json', '编辑参数字段缺少冒号')
        this.phase = 'value'
      } else if (this.phase === 'value') {
        if (character !== '"') return invalid('invalid-type', 'target 与 content 必须是字符串')
        this.string = new JsonString(); this.purpose = this.field
      } else if (this.phase === 'separator') {
        if (character === ',') this.phase = 'key'
        else if (character === '}') {
          validateInput({ target: this.target, content: this.contentValue })
          this.phase = 'done'
        } else return invalid('invalid-json', '编辑参数字段后需要逗号或对象结束符')
      } else return invalid('trailing-json', '编辑参数对象后存在多余内容')
    }
  }

  finish(): TextReplaceArguments {
    if (this.string) return this.string.unfinished()
    if (!this.complete) return invalid('incomplete-json', '编辑参数 JSON 尚未完整结束')
    return validateInput({ target: this.target, content: this.contentValue })
  }
}

type Fragment = { kind: 'delta' | 'snapshot'; text: string }

/** One instance belongs to one host-identified tool call, never to chat/reasoning text. */
export class StreamingEditArguments {
  readonly identity: StreamingEditArgumentsIdentity
  private parser = new ArgumentParser()
  private buffer = ''
  private nextSequence: number
  private snapshotSequence = -1
  private events = new Map<number, Fragment>()
  private target: string | undefined
  private failure: StreamingEditArgumentsError | undefined
  private final: TextReplaceArguments | undefined

  constructor(identity: StreamingEditArgumentsIdentity, firstSequence = 0) {
    this.identity = Object.freeze({ ...identity })
    if (typeof identity.toolCallId !== 'string' || !identity.toolCallId || identity.toolName !== 'text.replace') throw new StreamingEditArgumentsError(identity.toolCallId, 'invalid-tool', '正文参数解析器只接受具有稳定调用身份的 text.replace')
    if (!Number.isSafeInteger(firstSequence) || firstSequence < 0) throw new StreamingEditArgumentsError(identity.toolCallId, 'invalid-sequence', '工具分片起始序号必须为非负整数')
    this.nextSequence = firstSequence
  }

  private reject(code: string, message: string): never {
    this.failure = new StreamingEditArgumentsError(this.identity.toolCallId, code, message)
    throw this.failure
  }
  private protect<T>(action: () => T): T {
    try { return action() } catch (error) {
      if (error instanceof StreamingEditArgumentsError) throw error
      return this.reject(error instanceof ArgumentSyntaxError ? error.code : 'invalid-json', error instanceof Error ? error.message : '编辑参数解析失败')
    }
  }
  private read(): StreamingEditArgumentsSnapshot {
    // Even snapshot recovery must first reconfirm its target before exposing the new buffer.
    return this.parser.target === undefined ? { complete: false } : {
      target: this.parser.target,
      ...(this.parser.content === undefined ? {} : { content: this.parser.content }),
      complete: this.parser.complete,
    }
  }
  private fixedTarget(parser: ArgumentParser): void {
    if (parser.target === undefined) return
    if (this.target !== undefined && parser.target !== this.target) this.reject('target-changed', '工具调用的编辑目标已改变')
    this.target = parser.target
  }
  private sequence(seq: number, fragment: Fragment): boolean {
    if (!Number.isSafeInteger(seq) || seq < 0) this.reject('invalid-sequence', '工具分片序号必须为非负整数')
    const previous = this.events.get(seq)
    if (previous) {
      if (previous.kind !== fragment.kind || previous.text !== fragment.text) this.reject('sequence-conflict', '同一工具分片序号收到不同内容')
      return false
    }
    if (seq <= this.snapshotSequence) {
      // An authoritative snapshot supersedes missing old deltas; remember late arrivals for dedup.
      this.events.set(seq, fragment)
      return false
    }
    if (this.final) this.reject('already-finished', '完整工具参数确认后不能继续接收分片')
    if (seq < this.nextSequence) this.reject('out-of-order', '工具分片乱序到达')
    if (fragment.kind === 'delta' && seq !== this.nextSequence) this.reject('sequence-gap', '工具分片存在缺口，需要完整参数前缀快照恢复')
    return true
  }

  push(seq: number, argumentsDelta: string): StreamingEditArgumentsSnapshot {
    if (this.failure) throw this.failure
    return this.protect(() => {
      if (typeof argumentsDelta !== 'string') this.reject('invalid-fragment', '工具参数分片必须是字符串')
      const fragment: Fragment = { kind: 'delta', text: argumentsDelta }
      if (!this.sequence(seq, fragment)) return this.read()
      this.parser.feed(argumentsDelta)
      this.fixedTarget(this.parser)
      this.buffer += argumentsDelta
      this.events.set(seq, fragment); this.nextSequence = seq + 1
      return this.read()
    })
  }

  /** Replaces the raw prefix and parser state; it never appends a final snapshot as a delta. */
  snapshot(seq: number, fullArgumentsPrefix: string): StreamingEditArgumentsSnapshot {
    if (this.failure && this.failure.code !== 'sequence-gap') throw this.failure
    return this.protect(() => {
      if (typeof fullArgumentsPrefix !== 'string') this.reject('invalid-fragment', '工具参数快照必须是字符串')
      const fragment: Fragment = { kind: 'snapshot', text: fullArgumentsPrefix }
      if (!this.sequence(seq, fragment)) {
        if (this.failure) throw this.failure
        return this.read()
      }
      const parser = new ArgumentParser()
      parser.feed(fullArgumentsPrefix)
      this.fixedTarget(parser)
      this.parser = parser; this.buffer = fullArgumentsPrefix; this.snapshotSequence = seq
      this.events.set(seq, fragment); this.nextSequence = seq + 1; this.failure = undefined
      return this.read()
    })
  }

  /** Final arguments must extend the latest raw prefix, including any unfinished escape. */
  finish(completeArguments: string): TextReplaceArguments {
    if (this.failure) throw this.failure
    return this.protect(() => {
      if (typeof completeArguments !== 'string') this.reject('invalid-fragment', '完整工具参数必须是 JSON 字符串')
      const parser = new ArgumentParser()
      parser.feed(completeArguments)
      const parsed = parser.finish()
      const input = validateInput(JSON.parse(completeArguments))
      if (!completeArguments.startsWith(this.buffer) || input.target !== parsed.target || input.content !== parsed.content) this.reject('final-mismatch', '完整工具参数与已接收的编辑分片不一致')
      this.fixedTarget(parser)
      if (this.final && (this.final.target !== input.target || this.final.content !== input.content)) this.reject('final-mismatch', '工具调用重复结束时参数改变')
      this.final = input; this.parser = parser; this.buffer = completeArguments
      return { ...input }
    })
  }
}
