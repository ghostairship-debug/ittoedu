import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runLessonMarkdownValidation, validateLessonMarkdown } from '../../scripts/validate-lesson-markdown'

const roots: string[] = []
function fixture(source: string) {
  const root = mkdtempSync(join(tmpdir(), 'lesson-markdown-validation-')); roots.push(root)
  const file = join(root, 'candidate.md'); writeFileSync(file, source)
  return { root, file }
}
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

describe('read-only lesson Markdown candidate validation', () => {
  it('accepts the formal simple content and math domain without changing source bytes', () => {
    const { file } = fixture('# 目标\n\n正文 **强调** 和 $\\frac{1}{2}$。\n\n- 活动一\n- 活动二\n\n| 阶段 | 内容 |\n| --- | --- |\n| 开始 | 观察 |\n\n$$\nx^2\n$$\n')
    const before = readFileSync(file)
    expect(validateLessonMarkdown(file).status).toBe('valid')
    expect(readFileSync(file)).toEqual(before)
  })
  it('reports nested list line/column and refuses aligned tables and unknown math', () => {
    const { file } = fixture('# 教学\n\n- 上层\n  - 下层\n')
    const output: string[] = []
    expect(runLessonMarkdownValidation([file], line => output.push(line))).toBe(1)
    expect(output[0]).toContain(`${file}:3:1`)
    expect(output[0]).toContain('嵌套或任务列表')
    writeFileSync(file, '| A |\n| :--- |\n| B |\n')
    expect(validateLessonMarkdown(file).diagnostics[0]?.message).toContain('表格列对齐')
    writeFileSync(file, '$\\unknown{x}$')
    expect(validateLessonMarkdown(file).status).toBe('invalid')
  })
  it('uses an explicit real resource directory, refusing missing and escaping references', () => {
    const { root, file } = fixture('![图](resources/image.png)\n')
    const base = join(root, 'lesson'); mkdirSync(join(base, 'resources'), { recursive: true })
    writeFileSync(join(base, 'resources/image.png'), new Uint8Array([1, 2, 3]))
    expect(validateLessonMarkdown(file).status).toBe('invalid')
    expect(validateLessonMarkdown(file, base).status).toBe('valid')
    writeFileSync(file, '![图](../candidate.md)\n')
    expect(validateLessonMarkdown(file, base).status).toBe('invalid')
    writeFileSync(file, '[材料](missing.pdf)\n')
    expect(validateLessonMarkdown(file, base).diagnostics[0]?.message).toContain('链接附件不可读取')
  })
  it('returns a separate command/read error without writing a missing candidate', () => {
    const { root } = fixture('正文')
    expect(runLessonMarkdownValidation([join(root, 'missing.md')], () => {})).toBe(2)
    expect(runLessonMarkdownValidation([], () => {})).toBe(2)
  })
})
