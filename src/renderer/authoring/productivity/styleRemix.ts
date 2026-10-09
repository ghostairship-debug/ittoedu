import { previewCourseStyleRemix, planCourseStyleRemixEdits, replaceCourseRemixText, type RemixSlot as CourseRemixSlot } from '../../../core/course/courseProductivityEdits'
import { equalComponentValue } from '../../../core/drivers/courseV10Operations'
import { textComponentDataSchema } from '../../../components/text/data'
import { measureTextComponent, renderTextComponent } from '../../../components/text/render'
import { designProductionStep, type ProductivityContext, type ProductivityApplyResult } from './index'

export interface RemixSlot extends CourseRemixSlot { warning?: string }
export interface StyleRemixPreview { projectId: string; revision: number; target: ProductivityContext['target']; sourceSceneId: string; sourceLabel: string; slots: RemixSlot[]; issues: string[] }
export function previewStyleRemix(context: ProductivityContext, sourceSceneId: string, replacements: Readonly<Record<string, string>>, options: { measure?: boolean } = {}): StyleRemixPreview {
  const preview = previewCourseStyleRemix(context.document, sourceSceneId, replacements)
  const slots: RemixSlot[] = preview.slots
  if (options.measure && typeof document !== 'undefined') {
    // Renderer measurement uses the common rich-text planner and retains the authored frame.
    for (const [index, slot] of slots.entries()) {
      const original = context.document.instances[slot.instanceId]!
      if (slot.issue || !original.frame || slot.dataPath.length !== 1 || slot.dataPath[0] !== 'content') continue
      const data = textComponentDataSchema.safeParse(original.data)
      if (!data.success) continue
      const next = { ...data.data, content: replaceCourseRemixText(data.data.content, slot.replacement) }
      const layout = measureTextComponent(renderTextComponent(document, next), original.frame, next.sizing)
      if (layout.overflows || layout.height > original.frame.height + .5) slots[index] = { ...slot, warning: '实际文字排版超出原框；副本创建后可继续调整文本框或缩短文字' }
    }
  }
  return { ...preview, slots, target: context.target }
}
export function applyStyleRemix(context: ProductivityContext, preview: StyleRemixPreview, _assetFiles: Readonly<Record<string, Uint8Array>> = {}): ProductivityApplyResult {
  try {
    if (context.target.documentId !== preview.target.documentId || context.target.epoch !== preview.target.epoch) throw new Error('预览目标已改变')
    const replacements = Object.fromEntries(preview.slots.map(slot => [slot.id, slot.replacement]))
    const checked = previewStyleRemix(context, preview.sourceSceneId, replacements)
    const content = (slots: RemixSlot[]) => slots.map(({ warning: _warning, ...slot }) => slot)
    if (!equalComponentValue(content(checked.slots), content(preview.slots))) throw new Error('参考内容已变化，请重新预览')
    // This form asks for every slot; the shared planner also accepts partial public intent.
    const failures = checked.slots.filter(slot => slot.issue).map(slot => `${slot.label}：${slot.issue}`)
    if (!checked.slots.length || failures.length) throw new Error(failures.join('\n') || '没有可替换的文字槽位')
    const plan = planCourseStyleRemixEdits(context.document, preview.sourceSceneId, replacements)
    return { ok: true, step: { ...designProductionStep(context, plan.edits), createdSurfaceId: plan.createdSurfaceId } }
  } catch (error) { return { ok: false, reason: error instanceof Error ? error.message : '样板改写失败' } }
}
