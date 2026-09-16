import { accessSync, constants, readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'
import { parseDocumentMarkdown } from '../src/shared/document/markdown'
import { documentRelativePathSchema } from '../src/shared/document/resources'
import type { DocumentDiagnostic } from '../src/shared/document/ports'
import { documentTextSlots, walkDocument } from '../src/shared/document/content'

const usage = '用法：npx tsx scripts/validate-lesson-markdown.ts <候选.md> [--baseDir <课例资源目录>]'
export const LESSON_MARKDOWN_SUPPORTED_FORMAT = `支持：1–6 级标题、段落、粗体/斜体/删除线、链接、行内代码、单段引用、平铺有序/无序列表、简单管道表格、分隔线、代码围栏、独立图片与受支持的 LaTeX 数学。
限制：列表不能嵌套，不能使用任务复选框；表格分隔行只用 ---，不能用 :--- / ---: / :---:；复杂对象须使用正式 cw-object-v1，不能自行编造字段；不接受任意 HTML、未闭合围栏/公式或未知数学命令。
数学使用 $…$ 或独占行的 $$ 围栏；分式、根式、上下标、求和/积分、aligned/cases/matrix 等以共用数学解析器实际校验结果为准。校验不会改稿或提交文件。`

export interface LessonMarkdownValidation {
  file: string
  status: 'valid' | 'invalid' | 'unreadable'
  diagnostics: DocumentDiagnostic[]
}
const issue = (message: string, source = '', fragment = ''): DocumentDiagnostic => {
  const offset = fragment ? Math.max(0, source.indexOf(fragment)) : 0
  const before = source.slice(0, offset)
  return { message, offset, endOffset: Math.min(source.length, offset + 1), line: before.split('\n').length, column: offset - before.lastIndexOf('\n') }
}

/** Read-only candidate validation. The sole document/math codec decides syntax. */
export function validateLessonMarkdown(filename: string, baseDir?: string): LessonMarkdownValidation {
  const file = resolve(filename)
  let source: string
  let root: string
  try {
    source = readFileSync(file, 'utf8')
    root = realpathSync(resolve(baseDir ?? dirname(file)))
    if (!statSync(root).isDirectory()) throw new Error('资源目录不是文件夹')
  } catch (error) { return { file, status: 'unreadable', diagnostics: [issue(`无法读取候选或资源目录：${(error as Error).message}`)] } }
  const requireResource = (path: string) => {
    documentRelativePathSchema.parse(path)
    const target = realpathSync(resolve(root, path))
    const within = relative(root, target)
    if (within === '..' || within.startsWith('../') || within.startsWith('..\\') || isAbsolute(within)) throw new Error('引用越出课例资源目录')
    if (!statSync(target).isFile()) throw new Error('引用不是文件')
    accessSync(target, constants.R_OK)
  }
  const parsed = parseDocumentMarkdown(source, {
    target: 'file', createId: () => randomUUID(),
    resolveImage: href => {
      if (/^(?:[a-z][a-z\d+.-]*:|\/|\\)/i.test(href)) throw new Error('图片须引用课例内的真实相对文件')
      const path = decodeURIComponent(href.split(/[?#]/)[0]!).replace(/^\.\//, '')
      try { requireResource(path) } catch (error) { throw new Error(`图片不可读取：${href}（${(error as Error).message}）`) }
      return { assetId: `validation-asset-${createHash('sha256').update(path).digest('hex').slice(0, 16)}`, source: { kind: 'relative', path } }
    },
  })
  if (parsed.status === 'invalid') return { file, status: 'invalid', diagnostics: parsed.diagnostics }
  const diagnostics: DocumentDiagnostic[] = []
  for (const resource of [...parsed.document.resources.assets, ...parsed.document.resources.components]) {
    if (resource.source.kind !== 'relative') continue // The codec rejects this for file targets.
    try { requireResource(resource.source.path) }
    catch (error) { diagnostics.push(issue(`附件不可读取：${resource.source.path}（${(error as Error).message}）`, source, resource.source.path)) }
  }
  const localLinks = new Set<string>()
  walkDocument(parsed.document.content.blocks, block => {
    for (const slot of documentTextSlots(block)) for (const inline of slot.content.inlines) {
      const href = inline.link?.href
      if (href && !/^(?:https?:|mailto:|data:|#)/i.test(href)) localLinks.add(href)
    }
  })
  for (const href of localLinks) {
    try { requireResource(decodeURIComponent(href.split(/[?#]/)[0]!).replace(/^\.\//, '')) }
    catch (error) { diagnostics.push(issue(`链接附件不可读取：${href}（${(error as Error).message}）`, source, href)) }
  }
  return { file, status: diagnostics.length ? 'invalid' : 'valid', diagnostics }
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
