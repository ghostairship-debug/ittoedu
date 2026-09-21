import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { DocumentDiagnostic } from '../shared/document/ports'
import { LESSON_MARKDOWN_SUPPORTED_FORMAT } from './lessonMarkdownValidation'

export type LessonPromptStage = 'teaching-brief' | 'teaching-plan' | 'presentation-brief' | 'presentation-script' | 'build'

/**
 * 软件内创作流程在运行时经 app.getAppPath() 读取的方法文件。
 * 这些是仓库相对路径，因此 electron-builder 的 files 清单必须覆盖它们，
 * 否则打包版的软件内创作提示词会在读取时直接 ENOENT。
 */
export const LESSON_AUTHORING_METHOD_PATHS: Record<LessonPromptStage, string> = {
  'teaching-brief': '.agents/skills/orchestrate-courseware/references/main-progression.md',
  'teaching-plan': '.agents/skills/orchestrate-courseware/references/teaching-design-quality.md',
  'presentation-brief': '.agents/skills/orchestrate-courseware/references/interaction-design.md',
  'presentation-script': '.agents/skills/orchestrate-courseware/references/interaction-design.md',
  build: '.agents/skills/build-courseware-project/references/build-method.md',
}

/** Read the applicable teaching contract, projecting the Builder-only section for software-internal runs. */
export async function readLessonAuthoringMethod(editorRoot: string, stage: LessonPromptStage): Promise<string> {
  const source = await fs.readFile(path.join(editorRoot, LESSON_AUTHORING_METHOD_PATHS[stage]), 'utf8')
  if (stage !== 'build') return source
  const markedSection = (name: string) => {
    const startMarker = `<!-- lesson-authoring-shared:${name}:start -->`
    const endMarker = `<!-- lesson-authoring-shared:${name}:end -->`
    const start = source.indexOf(startMarker)
    if (start < 0) return undefined
    const contentStart = start + startMarker.length
    const end = source.indexOf(endMarker, contentStart)
    if (end < 0) return undefined
    return source.slice(contentStart, end).trim()
  }
  const internalStart = source.indexOf('## 软件内 Builder V2 适用范围')
  const internal = internalStart < 0
    ? undefined
    : source.slice(internalStart, source.indexOf('\n## ', internalStart + 3) < 0
      ? source.length
      : source.indexOf('\n## ', internalStart + 3)).trim()
  const shared = ['carrier', 'mapping', 'editable', 'experience'].map(markedSection)
  if (!internal || shared.some(value => !value)) throw new Error('Builder 软件内方法投影缺少明确的同源章节或标记')
  return [internal, ...shared.map(value => value!)].join('\n\n')
}

export function formatLessonValidationDiagnostics(file: string, diagnostics: readonly DocumentDiagnostic[]): string {
  return diagnostics.map(diagnostic => `${file}:${diagnostic.line}:${diagnostic.column} ${diagnostic.message}`).join('\n')
}

export interface LessonAuthoringPromptInput {
  editorRoot: string
  stage: LessonPromptStage
  roleLabel: string
  mode: 'manual' | 'automatic'
  instruction: string
  candidatePath: string
  lessonDirectory: string
  materials: unknown
  sessionDiagnostics?: readonly DocumentDiagnostic[]
}

/** Compose a human-readable native prompt without exposing external CLI instructions to the model. */
export async function buildLessonAuthoringPrompt(input: LessonAuthoringPromptInput): Promise<string> {
  const method = await readLessonAuthoringMethod(input.editorRoot, input.stage)
  const workflow = input.mode === 'automatic'
    ? '本轮由软件内自动创作流程派发。宿主已核验当前阶段前置文稿、材料与版本；自动模式不要求逐稿人工确认，文稿标为 draft 不构成阻断。外部独立 Skill 的教师确认停点不适用于本轮；不要要求教师补确认，也不要修改确认状态。只生成当前阶段候选，阶段推进与正式写入仍由宿主核验。'
    : '本轮由软件内手动创作流程派发。宿主核验前置阶段当前稿的逐稿确认；只生成当前阶段候选，完成后由工作台等待教师查看并确认，不自行推进或修改确认状态。'
  const output = input.stage === 'build'
    ? '输出受信课例构建 ES module，export const apiVersion = 2，default export async function(context)，从context解构api、documents、readAsset、encodeBase64。模块在当前浏览器窗口执行，无Buffer、fs、process或require；编码字节使用context.encodeBase64(value)，字符串按UTF-8编码。复用现有Builder V2单context参数合同。仅通过api.createCourseProject、observe/createScope/execute/finish使用现有Builder；模块不导入编辑器内部路径，只创建一个工程。必要资源通过context.readAsset读取。'
    : `输出完整${input.roleLabel} Markdown教师正文，不在正文写任务状态、候选/尚未提交说明、内部ID、hash或本轮暂存路径；材料依据使用可读标题与页/片段定位，状态由工作台显示。正文唯一一级标题必须是本阶段教学文稿标题；只完成本阶段，不越过教师确认或写后续稿。教学必须解释知识形成路径，不可只有题目与答案；呈现稿按片段写教学作用、演示页/流式讲义/无限画布选择及细布局、讲解、操作。`
  const format = input.stage === 'build' ? '' : `\n正文格式：${LESSON_MARKDOWN_SUPPORTED_FORMAT}`
  const diagnostics = input.sessionDiagnostics?.length
    ? `\n上一候选尚未写入正式文档。请在同一原生会话中修正后再次产出候选，先处理这些校验诊断：\n${formatLessonValidationDiagnostics(input.candidatePath, input.sessionDiagnostics)}`
    : ''
  return `教师创作目标：${input.instruction}\n当前任务：${input.roleLabel}，模式：${input.mode === 'automatic' ? '自动，无需逐稿人工确认' : '手动，完成当前稿后停下等待教师确认'}。\n${workflow}\n${output}\n读取当前课例真实文件及所选材料：${JSON.stringify(input.materials)}。本轮只把候选写入这个绝对路径：${input.candidatePath}。不覆盖任何正式教学文档、课件或authoring-state；候选由宿主读取、校验并在条件满足时正式保存。缺少关键事实时使用原生结构化提问；不能猜测教师已确认。${format}${diagnostics}\n适用方法：\n${method}\n本轮只完成当前阶段候选；保留已保存前阶段及其材料出处。`
}
