import { documentTextContentSchema, normalizeDocumentText, type FlowTextContent } from '../../../shared/document/content'
import type { JsonValue } from '../../../shared/contracts/component-platform/project'
import { componentValueAt, equalComponentValue } from '../../../core/drivers/courseV10Operations'
import { planTextRunRemap } from '../../../shared/textRuns'
import type { TextRun } from '../../../shared/contracts/native-v1/types'
import { textComponentDataSchema } from '../../../components/text/data'
import { measureTextComponent, renderTextComponent } from '../../../components/text/render'
import { designProductionStep, type ProductivityContext, type ProductivityApplyResult } from './index'
import { prepareReferenceClone } from './referenceClone'

export interface RemixSlot { id: string; instanceId: string; dataPath: string[]; label: string; original: string; replacement: string; capacity: string; issue?: string; warning?: string }
export interface StyleRemixPreview { projectId: string; revision: number; target: ProductivityContext['target']; sourceSceneId: string; sourceLabel: string; slots: RemixSlot[]; issues: string[] }
function reference(context: ProductivityContext, surfaceId: string) {
  const surface = context.document.surfaces.find(value => value.kind === 'slide' && value.id === surfaceId)
  if (!surface) throw new Error('参考页不存在，请重新选择')
  return surface
}
function replaceRich(content: FlowTextContent, text: string): FlowTextContent {
  if (content.inlines.some(inline => inline.type !== 'text')) throw new Error('公式与文字混排请在原文选区中编辑')
  let offset = 0
  const runs: TextRun[] = content.inlines.map(inline => {
    const value = inline.type === 'text' ? inline.text : '', start = offset; offset += Array.from(value).length
    return { start, end: offset, style: { ...inline.style } }
  })
  const mapped = planTextRunRemap(content.inlines.map(inline => inline.type === 'text' ? inline.text : '').join(''), text, runs)
  if (!mapped.ok) throw new Error(mapped.reason)
  const atoms = content.inlines.flatMap(inline => inline.type === 'text' ? Array.from(inline.text).map(text => ({ ...inline, text })) : [])
  for (const edit of [...mapped.edits].reverse()) {
    const source = atoms[edit.start] ?? atoms[edit.start - 1] ?? { type: 'text' as const, text: '' }
    atoms.splice(edit.start, edit.end - edit.start, ...Array.from(edit.replacement).map(text => ({ ...source, text })))
  }
  return normalizeDocumentText({ inlines: atoms })
}

export function previewStyleRemix(context: ProductivityContext, sourceSceneId: string, replacements: Readonly<Record<string, string>>, options: { measure?: boolean } = {}): StyleRemixPreview {
  const surface = reference(context, sourceSceneId), slots: RemixSlot[] = [], issues: string[] = []
  const visit = (instanceId: string, value: unknown, dataPath: string[]) => {
    if (!value || typeof value !== 'object') return
    const parsed = documentTextContentSchema.safeParse(value)
    if (parsed.success) {
      const item = context.document.instances[instanceId]!, id = `${instanceId}:${JSON.stringify(dataPath)}`
      if (parsed.data.inlines.some(inline => inline.type !== 'text')) { issues.push(`${item.name ?? instanceId}：保留公式混排，请在原页局部精修`); return }
      const original = parsed.data.inlines.map(inline => inline.type === 'text' ? inline.text : '').join(''), replacement = replacements[id] ?? ''
      let issue = replacement.trim() ? undefined : '请填写此槽位'
      if (!issue) try { replaceRich(parsed.data, replacement) } catch (error) { issue = error instanceof Error ? error.message : '无法保留文字格式' }
      const frame = item.frame
      let warning: string | undefined
      const textData = textComponentDataSchema.safeParse(item.data)
      if (options.measure && !issue && frame && textData.success && dataPath.length === 1 && dataPath[0] === 'content' && typeof document !== 'undefined') {
        const next = { ...textData.data, content: replaceRich(parsed.data, replacement) }
        const layout = measureTextComponent(renderTextComponent(document, next), frame, next.sizing)
        if (layout.overflows || layout.height > frame.height + 0.5) warning = '实际文字排版超出原框；副本创建后可继续调整文本框或缩短文字'
      }
      slots.push({ id, instanceId, dataPath, label: item.name ?? context.document.definitions[item.definitionId]?.title ?? instanceId, original, replacement,
        capacity: frame ? `${frame.width} × ${frame.height}，保持原框` : '保持原排版', ...(issue ? { issue } : {}), ...(warning ? { warning } : {}) })
      return
    }
    if (Array.isArray(value)) value.forEach((child, index) => visit(instanceId, child, [...dataPath, String(index)]))
    else for (const [key, child] of Object.entries(value)) if (!['source', 'props', 'metadata'].includes(key)) visit(instanceId, child, [...dataPath, key])
  }
  const instance = (id: string) => {
    const item = context.document.instances[id]!
    const implementation = item.implementationOverride ?? context.document.definitions[item.definitionId]?.implementation
    if (!item.locked && implementation?.kind === 'builtin') visit(id, item.data, [])
    item.childIds?.forEach(instance)
  }
  surface.childIds.forEach(instance)
  if (!slots.length) issues.push('参考页没有可直接替换的正式文字槽位')
  for (const id of Object.keys(replacements)) if (!slots.some(slot => slot.id === id)) throw new Error(`槽位 ${id} 已不存在`)
  return { projectId: context.document.id, revision: context.document.revision, target: context.target, sourceSceneId, sourceLabel: surface.title, slots, issues }
}

export function applyStyleRemix(context: ProductivityContext, preview: StyleRemixPreview, _assetFiles: Readonly<Record<string, Uint8Array>> = {}): ProductivityApplyResult {
  try {
    if (context.target.documentId !== preview.target.documentId || context.target.epoch !== preview.target.epoch) throw new Error('预览目标已改变')
    const checked = previewStyleRemix(context, preview.sourceSceneId, Object.fromEntries(preview.slots.map(slot => [slot.id, slot.replacement])))
    const content = (slots: RemixSlot[]) => slots.map(({ warning: _warning, ...slot }) => slot)
    if (!equalComponentValue(content(checked.slots), content(preview.slots))) throw new Error('参考内容已变化，请重新预览')
    const failures = checked.slots.filter(slot => slot.issue).map(slot => `${slot.label}：${slot.issue}`)
    if (!checked.slots.length || failures.length) throw new Error(failures.join('\n') || '没有可替换的文字槽位')
    const clone = prepareReferenceClone(context, preview.sourceSceneId)
    clone.surface.title = `${clone.source.title} 改写`
    for (const slot of checked.slots) {
      const id = clone.ids.get(slot.instanceId)!, item = clone.instances.find(instance => instance.id === id)!
      const field = componentValueAt({ ...context.document, instances: { ...context.document.instances, [id]: item } }, ['instances', id, 'data', ...slot.dataPath])
      const parsed = documentTextContentSchema.parse(field.value)
      let parent = item.data as Record<string, unknown>
      for (const part of slot.dataPath.slice(0, -1)) parent = parent[part] as Record<string, unknown>
      if (!slot.dataPath.length) item.data = replaceRich(parsed, slot.replacement) as unknown as JsonValue
      else parent[slot.dataPath.at(-1)!] = replaceRich(parsed, slot.replacement)
    }
    return { ok: true, step: { ...designProductionStep(context, clone.edits), createdSurfaceId: clone.surface.id } }
  } catch (error) { return { ok: false, reason: error instanceof Error ? error.message : '样板改写失败' } }
}
