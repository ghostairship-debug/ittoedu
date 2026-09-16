import { decodeImageTransformPng } from '../shared/imageTransform'
import { DesktopOperationError } from './errors'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { DocumentFilePort, DocumentFileRef, DocumentFileVersion } from '../shared/document/ports'
import type { LessonIdentity } from '../shared/lessonWorkspace'
import { lessonIdentityKey } from '../shared/lessonWorkspace'
import { LESSON_AUTHORING_STAGES, lessonAuthoringStateSchema, lessonAuthoringTicketSchema, lessonAuthoringMaterialSelectionSchema,
  type LessonAuthoringStage, type LessonAuthoringState, type LessonAuthoringTicket, type LessonAuthoringView, type LessonAuthoringBuildValidation,
  type LessonAuthoringMaterialSelection } from '../shared/lessonAuthoring'
import type { LessonWorkspaceService } from './lessonWorkspace'
import type { LessonMaterials } from './lessonMaterials'

export interface LessonAuthoringOptions {
  workspace: Pick<LessonWorkspaceService, 'read'>
  files: Pick<DocumentFilePort, 'openDocument'> & { readRecovery?(ref: DocumentFileRef): Promise<unknown> }
  materials: Pick<LessonMaterials, 'list' | 'read'>
  hasPendingDraft?: (ref: DocumentFileRef) => Promise<boolean>
}
const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const versionEqual = (a: DocumentFileVersion, b: DocumentFileVersion) => a.contentVersion === b.contentVersion
  && equal([...a.attachments].sort((x, y) => x.relativePath.localeCompare(y.relativePath)), [...b.attachments].sort((x, y) => x.relativePath.localeCompare(y.relativePath)))
export class LessonAuthoring {
  private static readonly queues = new Map<string, Promise<unknown>>()
  constructor(private readonly options: LessonAuthoringOptions) {}
  private serial<T>(lesson: LessonIdentity, action: () => Promise<T>): Promise<T> {
    const key = lessonIdentityKey(lesson), previous = LessonAuthoring.queues.get(key) ?? Promise.resolve()
    const result = previous.then(action, action); LessonAuthoring.queues.set(key, result.catch(() => {})); return result
  }
  private async write(lesson: LessonIdentity, state: LessonAuthoringState) {
    await this.options.workspace.read(lesson)
    const filename = path.join(lesson.normalizedDirectory, '.courseware', 'authoring-state.json'), temporary = `${filename}.${randomUUID()}.tmp`
    try { await fs.writeFile(temporary, JSON.stringify(lessonAuthoringStateSchema.parse(state), null, 2), { flag: 'wx' }); await fs.rename(temporary, filename) }
    finally { await fs.rm(temporary, { force: true }) }
  }
  private async readState(lesson: LessonIdentity): Promise<LessonAuthoringState> {
    try {
      const state = lessonAuthoringStateSchema.parse(JSON.parse(await fs.readFile(path.join(lesson.normalizedDirectory, '.courseware', 'authoring-state.json'), 'utf8')))
      if (state.lessonId !== lesson.lessonId) throw new LessonAuthoringValidationError('阶段记录不属于当前课例')
      return state
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      return { schemaVersion: 1, lessonId: lesson.lessonId, mode: 'manual', epoch: 0, controlEpoch: 0, documents: {}, materials: [] }
    }
  }
  private async readMaterials(lesson: LessonIdentity, selections: LessonAuthoringMaterialSelection[]): Promise<LessonAuthoringState['materials']> {
    if (!selections.length) throw new LessonAuthoringValidationError('自动创作需要至少一份成功读取的课例材料')
    const target = { lessonId: lesson.lessonId, rootPath: lesson.normalizedDirectory }
    const records = await this.options.materials.list(target), baselines: LessonAuthoringState['materials'] = []
    for (const raw of selections) {
      const selection = lessonAuthoringMaterialSelectionSchema.parse({ id: raw.id, extractionVersion: raw.extractionVersion, fragmentIds: raw.fragmentIds })
      const record = records.find(item => item.id === selection.id)
      if (!record) throw new LessonAuthoringValidationError('所选材料不存在')
      const receipt = await this.options.materials.read(target, selection)
      const relevantGap = record.gaps.find(gap => {
        const matches = (fragment: typeof receipt.fragments[number]) => fragment.locator.part === gap.locator.part
          && (gap.locator.page === undefined || fragment.locator.page === gap.locator.page)
          && (gap.locator.paragraph === undefined || fragment.locator.paragraph === gap.locator.paragraph)
        if (!receipt.fragments.some(matches)) return false
        // This proves saved page pixels are available to read, never model understanding.
        if (record.format !== 'pdf' || gap.resolution?.kind !== 'read-page-image' || gap.locator.page === undefined) return true
        const assetId = gap.resolution.assetId
        if (!receipt.fragments.some(fragment => matches(fragment) && fragment.kind === 'image' && fragment.assetId === assetId)) return true
        const image = receipt.assets.find(asset => asset.id === assetId && asset.mime === 'image/png')
        if (!image) return true
        try { decodeImageTransformPng(image.bytes); return false } catch { return true }
      })
      if (relevantGap) throw new LessonAuthoringValidationError(`当前教学范围材料未完整读取：${relevantGap.reason}`)
      if (!receipt.fragments.some(fragment => fragment.text?.trim() || fragment.assetId && receipt.assets.some(asset => asset.id === fragment.assetId && asset.bytes.byteLength))) throw new LessonAuthoringValidationError('所选材料没有实际可用正文或图示')
      baselines.push({ ...selection, sourceVersion: receipt.sourceVersion })
    }
    return baselines
  }
  private async synchronize(lesson: LessonIdentity): Promise<LessonAuthoringView> {
    const workspace = await this.options.workspace.read(lesson), state = await this.readState(lesson), before = JSON.stringify(state)
    const documents: LessonAuthoringView['documents'] = [], issues: string[] = []
    let earliestChange: number = LESSON_AUTHORING_STAGES.length
    for (const [index, role] of LESSON_AUTHORING_STAGES.entries()) {
      const relativePath = workspace.manifest.documents[role], prior = state.documents[role]
      if (!relativePath) {
        if (prior) { delete state.documents[role]; earliestChange = Math.min(earliestChange, index) }
        issues.push(`${role}：尚无实际文档`); continue
      }
      const ref = { lessonId: lesson.lessonId, lessonDirectory: lesson.normalizedDirectory, relativePath }
      try {
        const disk = await this.options.files.openDocument(ref)
        if (!disk.source.trim()) throw new LessonAuthoringValidationError('当前文档为空')
        if (disk.diagnostics.length || disk.version.attachments.some(attachment => attachment.contentVersion === 'missing')) throw new LessonAuthoringValidationError(disk.diagnostics[0]?.message ?? '引用附件不可读取')
        await this.assertOutputWritable(lesson, relativePath)
        if (!prior || prior.relativePath !== relativePath || !versionEqual(prior.version, disk.version)) {
          if (prior) earliestChange = Math.min(earliestChange, index)
          state.documents[role] = { relativePath, version: disk.version, needsReview: !!prior }
        }
        documents.push({ role, relativePath, version: disk.version, status: 'draft' })
      } catch (error) {
        if (prior?.confirmedAt !== undefined) { delete prior.confirmedAt; earliestChange = Math.min(earliestChange, index) }
        issues.push(`${role}：${(error as Error).message}`)
      }
    }
    if (earliestChange < LESSON_AUTHORING_STAGES.length) {
      state.epoch++
      for (const role of LESSON_AUTHORING_STAGES.slice(earliestChange)) {
        const document = state.documents[role]
        if (document) { delete document.confirmedAt; document.needsReview = true }
      }
    }
    if (state.mode === 'automatic') {
      try {
        const current = await this.readMaterials(lesson, state.materials)
        if (!equal(current, state.materials)) throw new LessonAuthoringValidationError('已读材料版本已变化，请重新选择读取范围')
      } catch (error) { issues.push((error as Error).message) }
    }
    for (const document of documents) {
      const current = state.documents[document.role]!
      document.status = current.confirmedAt !== undefined ? 'confirmed' : current.needsReview ? 'review' : 'draft'
    }
    const currentStage = LESSON_AUTHORING_STAGES.find(role => !documents.some(document => document.role === role)
      || state.mode === 'manual' && state.documents[role]?.confirmedAt === undefined
      || state.mode === 'automatic' && state.documents[role]?.needsReview) ?? 'build'
    if (JSON.stringify(state) !== before) await this.write(lesson, state)
    return { state, currentStage, documents, issues }
  }
  read(lesson: LessonIdentity): Promise<LessonAuthoringView> { return this.serial(lesson, () => this.synchronize(lesson)) }
  setMode(lesson: LessonIdentity, mode: 'manual' | 'automatic', selections: LessonAuthoringMaterialSelection[] = []): Promise<LessonAuthoringView> {
    return this.serial(lesson, async () => {
      const view = await this.synchronize(lesson)
      const materials = mode === 'automatic' || selections.length ? await this.readMaterials(lesson, selections) : view.state.materials
      if (view.state.mode !== mode || !equal(view.state.materials, materials)) { view.state.epoch++; view.state.controlEpoch++ }
      view.state.mode = mode; view.state.materials = materials
      await this.write(lesson, view.state)
      return this.synchronize(lesson)
    })
  }
  confirm(lesson: LessonIdentity, role: LessonAuthoringStage, expectedVersion: DocumentFileVersion): Promise<LessonAuthoringView> {
    return this.serial(lesson, async () => {
      const view = await this.synchronize(lesson)
      if (view.state.mode !== 'manual') throw new LessonAuthoringValidationError('自动流程不设置教师逐稿确认')
      if (view.currentStage !== role) throw new LessonAuthoringValidationError('请按当前阶段分别确认真实文档')
      const disk = view.documents.find(document => document.role === role)
      if (!disk || !versionEqual(disk.version, expectedVersion)) throw new LessonAuthoringValidationError('当前正文或附件已变化，请重新查看后确认')
      const current = view.state.documents[role]!
      current.confirmedAt = Date.now(); current.needsReview = false; view.state.epoch++; view.state.controlEpoch++
      await this.write(lesson, view.state)
      return this.synchronize(lesson)
    })
  }
  returnToStage(lesson: LessonIdentity, role: LessonAuthoringStage): Promise<LessonAuthoringView> {
    return this.serial(lesson, async () => {
      const view = await this.synchronize(lesson), index = LESSON_AUTHORING_STAGES.indexOf(role)
      if (index < 0) throw new LessonAuthoringValidationError('未知阶段')
      for (const stage of LESSON_AUTHORING_STAGES.slice(index)) {
        const document = view.state.documents[stage]
        if (document) { delete document.confirmedAt; document.needsReview = true }
      }
      view.state.epoch++; view.state.controlEpoch++; await this.write(lesson, view.state); return this.synchronize(lesson)
    })
  }
  stop(lesson: LessonIdentity): Promise<LessonAuthoringView> {
    return this.serial(lesson, async () => { const view = await this.synchronize(lesson); view.state.epoch++; view.state.controlEpoch++; await this.write(lesson, view.state); return view })
  }
  private buildValidation(view: LessonAuthoringView, expectedEpoch?: number): LessonAuthoringBuildValidation {
    const issues = [...view.issues]
    if (expectedEpoch !== undefined && view.state.epoch !== expectedEpoch) issues.push('任务阶段已变化，旧构建候选不能提交')
    if (view.state.mode === 'manual') for (const role of LESSON_AUTHORING_STAGES) {
      if (view.state.documents[role]?.confirmedAt === undefined) issues.push(`${role}：当前稿尚未确认`)
    }
    if (view.state.mode === 'automatic' && !view.state.materials.length) issues.push('自动创作缺少真实已读材料')
    if (view.state.mode === 'automatic') for (const role of LESSON_AUTHORING_STAGES) if (view.state.documents[role]?.needsReview) issues.push(`${role}：上游改稿后需要按当前输入重新完成本阶段`)
    return { allowed: !issues.length, epoch: view.state.epoch, mode: view.state.mode,
      documents: view.documents.map(({ role, relativePath, version }) => ({ role, relativePath, version })), materials: view.state.materials, issues }
  }
  validateBuild(lesson: LessonIdentity, expectedEpoch?: number): Promise<LessonAuthoringBuildValidation> {
    return this.serial(lesson, async () => this.buildValidation(await this.synchronize(lesson), expectedEpoch))
  }
  beginTask(lesson: LessonIdentity, stage: LessonAuthoringStage | 'build'): Promise<LessonAuthoringTicket> {
    return this.serial(lesson, async () => {
      const view = await this.synchronize(lesson), index = stage === 'build' ? LESSON_AUTHORING_STAGES.length : LESSON_AUTHORING_STAGES.indexOf(stage)
      if (index < 0) throw new LessonAuthoringValidationError('未知阶段')
      if (stage !== 'build') {
        const relativePath = (await this.options.workspace.read(lesson)).manifest.documents[stage]
        if (relativePath) await this.assertOutputWritable(lesson, relativePath)
      }
      if (stage === 'build') { const check = this.buildValidation(view); if (!check.allowed) throw new LessonAuthoringValidationError(check.issues.join('；')) }
      const inputs = view.documents.filter(document => LESSON_AUTHORING_STAGES.indexOf(document.role) < index)
      if (inputs.length !== index || view.state.mode === 'manual' && inputs.some(document => document.status !== 'confirmed')) throw new LessonAuthoringValidationError('前置阶段当前稿尚未完成或确认')
      if (view.state.mode === 'automatic' && (!view.state.materials.length || view.issues.some(issue => !LESSON_AUTHORING_STAGES.some(role => issue.startsWith(`${role}：`))))) throw new LessonAuthoringValidationError('自动流程需要当前有效的真实材料读取结果')
      return lessonAuthoringTicketSchema.parse({ schemaVersion: 1, id: randomUUID(), lesson, epoch: view.state.epoch, controlEpoch: view.state.controlEpoch, stage, mode: view.state.mode,
        inputs: inputs.map(({ role, relativePath, version }) => ({ role, relativePath, version })), materials: view.state.materials })
    })
  }
  async assertOutputWritable(lesson: LessonIdentity, relativePath: string): Promise<void> {
    const ref = { lessonId: lesson.lessonId, lessonDirectory: lesson.normalizedDirectory, relativePath }
    if (await this.options.hasPendingDraft?.(ref) || await this.options.files.readRecovery?.(ref)) throw new LessonAuthoringValidationError('当前有未保存稿或冲突恢复稿，请先保存或处理冲突')
  }
  completeTask(lesson: LessonIdentity, input: LessonAuthoringTicket, expectedOutputVersion: DocumentFileVersion): Promise<LessonAuthoringView> {
    return this.serial(lesson, async () => {
      const ticket = lessonAuthoringTicketSchema.parse(input)
      if (ticket.stage === 'build') throw new LessonAuthoringValidationError('实际工程构建结果由正式宿主回执记录')
      const prior = await this.readState(lesson)
      if (lessonIdentityKey(ticket.lesson) !== lessonIdentityKey(lesson) || prior.controlEpoch !== ticket.controlEpoch || prior.mode !== ticket.mode) throw new LessonAuthoringValidationError('任务在产出落盘前已经失效')
      const view = await this.synchronize(lesson)
      for (const baseline of ticket.inputs) {
        const current = view.documents.find(document => document.role === baseline.role)
        if (!current || current.relativePath !== baseline.relativePath || !versionEqual(current.version, baseline.version)) throw new LessonAuthoringValidationError('前置正文或附件已变化，不能完成旧稿阶段任务')
      }
      if (!equal(ticket.materials, view.state.materials) || view.state.mode === 'automatic' && view.issues.some(issue => !LESSON_AUTHORING_STAGES.some(role => issue.startsWith(`${role}：`)))) throw new LessonAuthoringValidationError('材料基准已失效')
      const output = view.documents.find(document => document.role === ticket.stage)
      if (!output || !versionEqual(output.version, expectedOutputVersion)) throw new LessonAuthoringValidationError('阶段输出未实际保存或版本已变化')
      const saved = view.state.documents[ticket.stage]!
      saved.needsReview = false; delete saved.confirmedAt
      await this.write(lesson, view.state)
      return this.synchronize(lesson)
    })
  }
  validateTask(lesson: LessonIdentity, input: LessonAuthoringTicket): Promise<LessonAuthoringBuildValidation> {
    return this.serial(lesson, async () => {
      const ticket = lessonAuthoringTicketSchema.parse(input), view = await this.synchronize(lesson)
      const issues: string[] = []
      if (lessonIdentityKey(ticket.lesson) !== lessonIdentityKey(lesson) || ticket.epoch !== view.state.epoch || ticket.mode !== view.state.mode) issues.push('任务目标或阶段已失效')
      for (const baseline of ticket.inputs) {
        const current = view.documents.find(document => document.role === baseline.role)
        if (!current || current.relativePath !== baseline.relativePath || !versionEqual(current.version, baseline.version)) issues.push(`${baseline.role}：任务采用的正文或附件已变化`)
      }
      if (!equal(ticket.materials, view.state.materials)) issues.push('任务材料基准已变化')
      if (ticket.stage === 'build') issues.push(...this.buildValidation(view, ticket.epoch).issues)
      if (view.state.mode === 'automatic') issues.push(...view.issues.filter(issue => !LESSON_AUTHORING_STAGES.some(role => issue.startsWith(`${role}：`))))
      return { allowed: !issues.length, epoch: view.state.epoch, mode: view.state.mode, documents: ticket.inputs, materials: view.state.materials, issues }
    })
  }
}

class LessonAuthoringValidationError extends DesktopOperationError {
  constructor(message: string) { super('LESSON_AUTHORING_VALIDATION', '创作阶段未完成', message, '请根据提示处理当前材料或文档后继续。') }
}
