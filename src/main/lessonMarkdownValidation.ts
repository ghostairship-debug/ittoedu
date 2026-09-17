import { accessSync, constants, realpathSync, statSync } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { parseDocumentMarkdown } from '../shared/document/markdown'
import { documentRelativePathSchema } from '../shared/document/resources'
import type { DocumentDiagnostic } from '../shared/document/ports'
import { documentTextSlots, walkDocument } from '../shared/document/content'

export interface LessonMarkdownValidation {
  file: string
  status: 'valid' | 'invalid' | 'unreadable'
  diagnostics: DocumentDiagnostic[]
}

export interface LessonMarkdownValidationInput {
  /** Candidate source supplied by the caller; this function never reads or writes it. */
  source: string
  /** Candidate path used for diagnostics and for the default resource root. */
  file: string
  /** Resource root. Relative Markdown references are resolved beneath this directory. */
  baseDir?: string
}

export const LESSON_MARKDOWN_SUPPORTED_FORMAT = `支持：1–6 级标题、段落、粗体/斜体/删除线、链接、行内代码、单段引用、平铺有序/无序列表、简单管道表格、分隔线、代码围栏、独立图片与受支持的 LaTeX 数学。
限制：列表不能嵌套，不能使用任务复选框；表格分隔行只用 ---，不能用 :--- / ---: / :---:；复杂对象须使用正式 cw-object-v1，不能自行编造字段；不接受任意 HTML、未闭合围栏/公式或未知数学命令。
数学使用 $…$ 或独占行的 $$ 围栏；分式、根式、上下标、求和/积分、aligned/cases/matrix 等以共用数学解析器实际校验结果为准。校验不会改稿或提交文件。`

function issue(message: string, source = '', fragment = ''): DocumentDiagnostic {
  const offset = fragment ? Math.max(0, source.indexOf(fragment)) : 0
  const before = source.slice(0, offset)
  return {
    message,
    offset,
    endOffset: Math.min(source.length, offset + 1),
    line: before.split('\n').length,
    column: offset - before.lastIndexOf('\n'),
  }
}

/** Build the same unreadable result used by the CLI when its input cannot be opened. */
export function unreadableLessonMarkdown(file: string, error: unknown): LessonMarkdownValidation {
  return {
    file: resolve(file),
    status: 'unreadable',
    diagnostics: [issue(`无法读取候选或资源目录：${error instanceof Error ? error.message : String(error)}`)],
  }
}

/**
 * Validate candidate source with the formal Markdown/math codec and its real
 * resource directory. This is deliberately read-only: `source` is supplied by
 * the caller, and only metadata/read access is performed for referenced files.
 */
export function validateLessonMarkdownSource(source: string, file: string, baseDir?: string): LessonMarkdownValidation
export function validateLessonMarkdownSource(input: LessonMarkdownValidationInput): LessonMarkdownValidation
export function validateLessonMarkdownSource(
  sourceOrInput: string | LessonMarkdownValidationInput,
  fileArgument?: string,
  baseDirArgument?: string,
): LessonMarkdownValidation {
  const input = typeof sourceOrInput === 'string'
    ? { source: sourceOrInput, file: fileArgument ?? '', baseDir: baseDirArgument }
    : sourceOrInput
  const source = input.source
  const file = resolve(input.file)
  let root: string
  try {
    root = realpathSync(resolve(input.baseDir ?? dirname(file)))
    if (!statSync(root).isDirectory()) throw new Error('资源目录不是文件夹')
  } catch (error) {
    return unreadableLessonMarkdown(file, error)
  }

  const requireResource = (resourcePath: string) => {
    documentRelativePathSchema.parse(resourcePath)
    const target = realpathSync(resolve(root, resourcePath))
    const within = relative(root, target)
    if (within === '..' || within.startsWith('../') || within.startsWith('..\\') || isAbsolute(within)) {
      throw new Error('引用越出课例资源目录')
    }
    if (!statSync(target).isFile()) throw new Error('引用不是文件')
    accessSync(target, constants.R_OK)
  }

  const parsed = parseDocumentMarkdown(source, {
    target: 'file',
    createId: () => randomUUID(),
    resolveImage: href => {
      if (/^(?:[a-z][a-z\d+.-]*:|\/|\\)/i.test(href)) throw new Error('图片须引用课例内的真实相对文件')
      const resourcePath = decodeURIComponent(href.split(/[?#]/)[0]!).replace(/^\.\//, '')
      try {
        requireResource(resourcePath)
      } catch (error) {
        throw new Error(`图片不可读取：${href}（${error instanceof Error ? error.message : String(error)}）`)
      }
      return {
        assetId: `validation-asset-${createHash('sha256').update(resourcePath).digest('hex').slice(0, 16)}`,
        source: { kind: 'relative', path: resourcePath },
      }
    },
  })
  if (parsed.status === 'invalid') return { file, status: 'invalid', diagnostics: parsed.diagnostics }

  const diagnostics: DocumentDiagnostic[] = []
  for (const resource of [...parsed.document.resources.assets, ...parsed.document.resources.components]) {
    if (resource.source.kind !== 'relative') continue
    try {
      requireResource(resource.source.path)
    } catch (error) {
      diagnostics.push(issue(
        `附件不可读取：${resource.source.path}（${error instanceof Error ? error.message : String(error)}）`,
        source,
        resource.source.path,
      ))
    }
  }

  const localLinks = new Set<string>()
  walkDocument(parsed.document.content.blocks, block => {
    for (const slot of documentTextSlots(block)) for (const inline of slot.content.inlines) {
      const href = inline.link?.href
      if (href && !/^(?:https?:|mailto:|data:|#)/i.test(href)) localLinks.add(href)
    }
  })
  for (const href of localLinks) {
    try {
      requireResource(decodeURIComponent(href.split(/[?#]/)[0]!).replace(/^\.\//, ''))
    } catch (error) {
      diagnostics.push(issue(
        `链接附件不可读取：${href}（${error instanceof Error ? error.message : String(error)}）`,
        source,
        href,
      ))
    }
  }
  return { file, status: diagnostics.length ? 'invalid' : 'valid', diagnostics }
}

/** Object-form alias for consumers that pass a validation request record. */
export function validateLessonMarkdown(input: LessonMarkdownValidationInput): LessonMarkdownValidation
export function validateLessonMarkdown(source: string, file: string, baseDir?: string): LessonMarkdownValidation
export function validateLessonMarkdown(
  sourceOrInput: string | LessonMarkdownValidationInput,
  file?: string,
  baseDir?: string,
): LessonMarkdownValidation {
  return typeof sourceOrInput === 'string'
    ? validateLessonMarkdownSource(sourceOrInput, file ?? '', baseDir)
    : validateLessonMarkdownSource(sourceOrInput)
}
