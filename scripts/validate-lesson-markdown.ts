import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  LESSON_MARKDOWN_SUPPORTED_FORMAT,
  unreadableLessonMarkdown,
  validateLessonMarkdownSource,
  type LessonMarkdownValidation,
} from '../src/main/lessonMarkdownValidation'
export { LESSON_MARKDOWN_SUPPORTED_FORMAT } from '../src/main/lessonMarkdownValidation'
export type { LessonMarkdownValidation } from '../src/main/lessonMarkdownValidation'

const usage = '用法：npx tsx scripts/validate-lesson-markdown.ts <候选.md> [--baseDir <课例资源目录>]'
/** Read-only CLI wrapper around the main-process source validator. */
export function validateLessonMarkdown(filename: string, baseDir?: string): LessonMarkdownValidation {
  const file = resolve(filename)
  let source: string
  try {
    source = readFileSync(file, 'utf8')
  } catch (error) {
    return unreadableLessonMarkdown(file, error)
  }
  return validateLessonMarkdownSource(source, file, baseDir)
}

export function runLessonMarkdownValidation(argv: string[], write: (line: string) => void = console.log): number {
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0]!)) { write(`${usage}\n${LESSON_MARKDOWN_SUPPORTED_FORMAT}`); return 0 }
  if (!(argv.length === 1 || argv.length === 3 && argv[1] === '--baseDir') || !argv[0] || argv[0].startsWith('--')) { write(usage); return 2 }
  const report = validateLessonMarkdown(argv[0], argv[2])
  if (report.status === 'valid') { write(`校验通过：${report.file}（正文格式与引用附件可读取；尚未提交或确认）`); return 0 }
  for (const diagnostic of report.diagnostics) write(`${report.file}:${diagnostic.line}:${diagnostic.column} ${diagnostic.message}`)
  write('请修正当前候选后重新校验；不要扁平化或丢弃教师内容。格式范围：docs/reference/lesson-markdown-validation.md')
  return report.status === 'unreadable' ? 2 : 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) process.exitCode = runLessonMarkdownValidation(process.argv.slice(2))
