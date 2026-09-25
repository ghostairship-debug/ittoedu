// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { StreamingEditArguments, StreamingEditArgumentsError } from '../../src/core/execution/StreamingEditArguments'

const create = (firstSequence = 0) => new StreamingEditArguments({ toolCallId: 'call-1', toolName: 'text.replace' }, firstSequence)
function rejects(action: () => unknown, code: string) {
  let caught: unknown
  try { action() } catch (error) { caught = error }
  expect(caught).toBeInstanceOf(StreamingEditArgumentsError)
  expect(caught).toMatchObject({ toolCallId: 'call-1', code })
}

describe('S06 strict incremental text.replace arguments', () => {
  it('projects actual Chinese, escaped newlines and emoji before finish even with one UTF-16 unit per chunk', () => {
    const stream = create()
    const raw = '{"target":"t-1","content":"中文😀\\n下一行\\uD83D\\uDE80\\t结束"}'
    const expected = '中文😀\n下一行🚀\t结束'
    const emitted: string[] = []
    for (let seq = 0; seq < raw.length; seq += 1) {
      const snapshot = stream.push(seq, raw[seq]!)
      if (snapshot.content !== undefined) {
        expect(snapshot.target).toBe('t-1')
        expect(expected.startsWith(snapshot.content)).toBe(true)
        expect(snapshot.content).not.toMatch(/[\uD800-\uDBFF]$/u)
        emitted.push(snapshot.content)
      }
      if (seq < raw.length - 1) expect(snapshot.complete).toBe(false)
    }
    expect(emitted).toContain('中文')
    expect(emitted).toContain('中文😀\n下一行')
    expect(emitted.at(-1)).toBe(expected)
    expect(stream.finish(raw)).toEqual({ target: 't-1', content: expected })
  })

  it('buffers content-first arguments until the whole target string arrives', () => {
    const stream = create()
    const prefix = '{"content":"已经生成\\n完整正文","target":"ta'
    expect(stream.push(0, prefix)).toEqual({ complete: false })
    expect(stream.push(1, 'rget')).toEqual({ complete: false })
    expect(stream.push(2, '"')).toEqual({ target: 'target', content: '已经生成\n完整正文', complete: false })
    expect(stream.push(3, '}')).toEqual({ target: 'target', content: '已经生成\n完整正文', complete: true })
    expect(stream.finish(prefix + 'rget"}')).toEqual({ target: 'target', content: '已经生成\n完整正文' })
  })

  it('decodes all JSON escapes once and withholds a split escaped surrogate pair', () => {
    const stream = create()
    const prefix = '{"target":"t","content":"A\\uD83D'
    expect(stream.push(0, prefix)).toEqual({ target: 't', content: 'A', complete: false })
    expect(stream.push(1, '\\uDE')).toEqual({ target: 't', content: 'A', complete: false })
    const end = '00\\b\\f\\n\\r\\t\\/\\\\\\"\\u4e2d"}'
    expect(stream.push(2, end)).toEqual({ target: 't', content: 'A😀\b\f\n\r\t/\\"中', complete: true })
    expect(stream.finish(prefix + '\\uDE' + end).content).toBe('A😀\b\f\n\r\t/\\"中')
  })

  it('deduplicates exact deltas and finish receipts without appending the final text twice', () => {
    const stream = create(1), first = '{"target":"t","content":"one', last = ' two"}'
    stream.push(1, first)
    stream.push(2, last)
    expect(stream.push(1, first)).toEqual({ target: 't', content: 'one two', complete: true })
    const result = stream.finish(first + last)
    result.content = 'mutated by caller'
    expect(stream.finish(first + last)).toEqual({ target: 't', content: 'one two' })
    expect(stream.push(2, last).content).toBe('one two')
    rejects(() => stream.push(3, ' '), 'already-finished')
  })

  it('fails gaps until an explicit snapshot replaces the prefix, and ignores superseded late fragments', () => {
    const stream = create()
    stream.push(0, '{"target":"t","content":"old')
    rejects(() => stream.push(2, ' missing"}'), 'sequence-gap')
    rejects(() => stream.finish('{"target":"t","content":"old missing"}'), 'sequence-gap')
    const replacement = '{"target":"t","content":"new'
    expect(stream.snapshot(4, replacement)).toEqual({ target: 't', content: 'new', complete: false })
    expect(stream.push(1, 'late')).toEqual({ target: 't', content: 'new', complete: false })
    expect(stream.push(1, 'late')).toEqual({ target: 't', content: 'new', complete: false })
    expect(stream.snapshot(4, replacement)).toEqual({ target: 't', content: 'new', complete: false })
    expect(stream.push(5, ' snapshot"}')).toEqual({ target: 't', content: 'new snapshot', complete: true })
    expect(stream.finish(replacement + ' snapshot"}').content).toBe('new snapshot')
    expect(stream.push(2, 'superseded after completion')).toEqual({ target: 't', content: 'new snapshot', complete: true })
    rejects(() => stream.push(1, 'different late text'), 'sequence-conflict')
  })

  it('does not release replacement snapshot content until its same fixed target is reconfirmed', () => {
    const stream = create()
    stream.push(0, '{"target":"t","content":"old')
    expect(stream.snapshot(3, '{"content":"new","target":"')).toEqual({ complete: false })
    expect(stream.push(4, 't"}')).toEqual({ target: 't', content: 'new', complete: true })
    expect(stream.finish('{"content":"new","target":"t"}')).toEqual({ target: 't', content: 'new' })
  })

  it('terminates changed targets, conflicting sequences and unknown out-of-order deltas', () => {
    const changed = create()
    changed.push(0, '{"target":"t","content":"one')
    rejects(() => changed.snapshot(2, '{"target":"elsewhere","content":"two"}'), 'target-changed')
    rejects(() => changed.snapshot(3, '{"target":"t","content":"one"}'), 'target-changed')
    const conflicting = create()
    conflicting.push(0, '{"target":"t"')
    rejects(() => conflicting.push(0, '{"target":"other"'), 'sequence-conflict')
    const reversed = create(2)
    reversed.push(2, '{')
    rejects(() => reversed.push(1, ' '), 'out-of-order')
  })

  it.each([
    ['{"target":"t","target":"t","content":"x"}', 'duplicate-key'],
    ['{"target":"t","content":"x","con\\u0074ent":"x"}', 'duplicate-key'],
    ['{"target":"t","content":"x","metadata":{}}', 'unexpected-field'],
    ['{"target":null,"content":"x"}', 'invalid-type'],
    ['{"target":"t","content":123}', 'invalid-type'],
    ['{"target":"t","content":{}}', 'invalid-type'],
    ['{"target":"t","content":[]}', 'invalid-type'],
    ['{"target":"t","content":"x",}', 'invalid-key'],
    ['{"target":"t"}', 'invalid-schema'],
    ['{"content":"x"}', 'invalid-schema'],
    ['{"target":"","content":"x"}', 'invalid-schema'],
    [`{"target":"${'t'.repeat(101)}","content":"x"}`, 'invalid-schema'],
    ['{"target":"t","content":"x"} {}', 'trailing-json'],
    ['{"target":"t","content":"raw\nnewline"}', 'invalid-string'],
    ['{"target":"t","content":"\\x22"}', 'invalid-escape'],
    ['{"target":"t","content":"\\u12xz"}', 'invalid-escape'],
    ['{"target":"t","content":"\\uDE00"}', 'invalid-unicode'],
    ['{"target":"t","content":"\\uD83D!"}', 'invalid-unicode'],
    ['{"target":"t","content":"\\uD83D"}', 'invalid-unicode'],
    ['[]', 'invalid-root'],
  ])('explicitly rejects malformed/schema-invalid arguments: %s', (raw, code) => {
    const stream = create()
    rejects(() => stream.push(0, raw), code)
    rejects(() => stream.finish('{"target":"t","content":"recovered without snapshot"}'), code)
  })

  it.each([
    ['{"target":"t","content":"x\\u12', 'incomplete-unicode'],
    ['{"target":"t","content":"x\\uD83D', 'incomplete-unicode'],
    ['{"target":"t","content":"x\\', 'incomplete-escape'],
    ['{"target":"t","content":"x', 'incomplete-json'],
    ['{"target":"t","content":"x"', 'incomplete-json'],
  ])('rejects truncated final arguments without publishing uncertain characters: %s', (raw, code) => {
    const stream = create()
    expect(stream.push(0, raw).content).toBe('x')
    rejects(() => stream.finish(raw), code)
  })

  it('requires final raw arguments to extend the confirmed prefix instead of discarding partial escapes', () => {
    const changed = create()
    changed.push(0, '{"target":"t","content":"visible')
    rejects(() => changed.finish('{"target":"t","content":"different"}'), 'final-mismatch')
    const truncatedEscape = create()
    truncatedEscape.push(0, '{"target":"t","content":"visible\\uD8')
    rejects(() => truncatedEscape.finish('{"target":"t","content":"visible"}'), 'final-mismatch')
  })

  it('isolates a failing tool call and admits final-only arguments without inventing streamed text', () => {
    const failed = create()
    rejects(() => failed.push(0, 'ordinary chat or reasoning'), 'invalid-root')
    const next = create()
    expect(next.finish('{"target":"next","content":"final only"}')).toEqual({ target: 'next', content: 'final only' })
    rejects(() => new StreamingEditArguments({ toolCallId: 'call-1', toolName: 'reasoning' as 'text.replace' }), 'invalid-tool')
  })
})
