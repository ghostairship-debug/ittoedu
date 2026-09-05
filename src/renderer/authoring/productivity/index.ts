import type { CourseProjectDocument, FlowBlock, LayerItem } from '../../../shared/courseProjectTypes'
import type { TextRun } from '../../../shared/contracts/native-v1/types'
import { applyTextRunStyle, remapTextRuns } from '../../../shared/textRuns'
import { resolveEffectiveBackground, type EffectiveBackgroundRequest } from '../../../shared/effectiveBackground'
import type { CourseAuthoringSessionToken } from '../courseAuthoringSession'
import { createEditorTransactionStep, type EditorTransactionStep } from '../editorTransaction'
import { commitCourseProjectMutation } from '../../course/courseProjectMutation'

export interface ProductivityContext { document: CourseProjectDocument; sessionToken: CourseAuthoringSessionToken }
export type ProductivityScope = 'page' | 'surface' | 'course'
export type ColorProperty = 'text' | 'fill' | 'stroke' | 'background' | 'all'
export type ProductivityRequest = { kind: 'text'; scope: ProductivityScope; find: string; replacement: string } | { kind: 'color'; scope: ProductivityScope; tokenId: string; property: ColorProperty }
export interface ProductivityPreviewItem { id: string; target: string; owner: string; property: string; oldValue: string; newValue: string }
export interface ProductivityPreview { projectId: string; revision: number; sessionToken: CourseAuthoringSessionToken; request: ProductivityRequest; items: ProductivityPreviewItem[]; unsupported: string[] }
type Field = { id: string; target: string; owner: string; property: string; value: string; color?: ColorProperty; write(value: string, replacement?: { find: string; replacement: string }): void }
type Bag = Record<string, unknown>
const bag = (value: object): Bag => value as unknown as Bag

function fields(document: CourseProjectDocument, token: CourseAuthoringSessionToken, scope: ProductivityScope) {
  const result: Field[] = []; const unsupported: string[] = []
  const location = document.locations.find(l => l.id === token.locationId)
  if (!location) throw new Error('当前页面已失效')
  const add = (object: object, key: string, target: string, owner: string, color?: ColorProperty) => {
    const record = bag(object); const value = record[key]
    if (typeof value !== 'string') return
    result.push({ id: `${owner}/${target}/${key}/${result.length}`, target, owner, property: key, value, color, write(next, replacement) {
      if (key === 'text' && Array.isArray(record.runs)) {
        let current = value; let runs = record.runs as TextRun[]
        if (replacement) {
          const matches: number[] = []
          for (let i = value.indexOf(replacement.find); i >= 0; i = value.indexOf(replacement.find, i + replacement.find.length)) matches.push(i)
          matches.reverse().forEach(index => {
            const start = Array.from(current.slice(0, index)).length
            const end = start + Array.from(replacement.find).length
            const inserted = Array.from(replacement.replacement).length
            const delta = inserted - (end - start)
            runs = runs.flatMap(run => {
              if (run.end <= start) return [run]
              if (run.start >= end) return [{ ...run, start: run.start + delta, end: run.end + delta }]
              const parts: TextRun[] = []
              if (run.start < start) parts.push({ ...run, end: start })
              if (run.start <= start && run.end > start && inserted) parts.push({ ...run, start, end: start + inserted })
              if (run.end > end) parts.push({ ...run, start: start + inserted, end: run.end + delta })
              return parts
            })
            current = current.slice(0, index) + replacement.replacement + current.slice(index + replacement.find.length)
          })
          record.runs = runs
        } else record.runs = remapTextRuns(value, next, runs)
      }
      record[key] = next
    } })
  }
  const style = (object: object, target: string, owner: string) => {
    for (const [key, category] of Object.entries({ color: 'text', textColor: 'text', fillColor: 'fill', borderColor: 'stroke', strokeColor: 'stroke', backgroundColor: 'background', highlightColor: 'background' } as const)) add(object, key, target, owner, category)
  }
  const rich = (object: object, target: string, owner: string, flow = true) => {
    add(object, 'text', target, owner)
    const runs = bag(object).runs
    if (flow && typeof bag(object).text === 'string' && bag(object).text) {
      const richText = object as { text: string; runs?: TextRun[] }
      const colors = [...new Set((richText.runs ?? []).map(r => r.style.color).filter(Boolean))]
      result.push({ id: `${owner}/${target}/全文颜色/${result.length}`, owner, target, property: '全文颜色', value: colors.length ? colors.join(' / ') : '默认文字色', color: 'text', write(value) { richText.runs = applyTextRunStyle(richText.text, richText.runs ?? [], 0, Array.from(richText.text).length, { color: value }) } })
    } else if (Array.isArray(runs)) runs.forEach((r: TextRun, i) => style(r.style, `${target}/格式${i + 1}`, owner))
  }
  const layer = (item: LayerItem, owner: string) => {
    const target = `${item.label} (${item.layerItemId})`
    if (item.kind !== 'native') { unsupported.push(`${owner} · ${target}：组件参数和运行时代码不参与批量修改`); return }
    const content = item.content
    if ('style' in content.data) style(content.data.style, target, owner)
    if (content.nativeType === 'text') rich(content.data, target, owner, false)
    else if (content.nativeType === 'table') content.data.rows.forEach(r => r.cells.forEach(c => { add(c, 'text', `${target}/单元格${c.id}`, owner); if (c.style) style(c.style, `${target}/单元格${c.id}`, owner) }))
    else if (content.nativeType === 'chart') {
      add(content.data, 'title', target, owner)
      content.data.categories.forEach(c => add(c, 'label', `${target}/分类${c.id}`, owner))
      content.data.series.forEach(s => { add(s, 'name', `${target}/系列${s.id}`, owner); add(s, 'color', `${target}/系列${s.id}`, owner, 'fill') })
    } else if (content.nativeType === 'input') add(content.data, 'placeholder', target, owner)
    else if (content.nativeType === 'teacher-controller') unsupported.push(`${owner} · ${target}：控制器配置不参与批量修改`)
  }
  const blocks = (entries: FlowBlock[], owner: string) => entries.forEach(block => {
    const target = `正文 (${block.id})`
    if (block.type === 'heading' || block.type === 'paragraph' || block.type === 'quote') { rich(block, target, owner); if (block.type === 'quote') add(block, 'citation', target, owner) }
    else if (block.type === 'list') block.items.forEach(item => rich(item, `${target}/${item.id}`, owner))
    else if (block.type === 'section') { add(block, 'title', target, owner); blocks(block.blocks, owner) }
    else if (block.type === 'callout') { add(block, 'title', target, owner); add(block, 'body', target, owner) }
    else if (block.type === 'media') { add(block, 'caption', target, owner); add(block, 'altText', target, owner) }
    else if (block.type === 'chart') {
      add(block.chart, 'title', target, owner); style(block.chart.style, target, owner)
      block.chart.categories.forEach(c => add(c, 'label', `${target}/分类${c.id}`, owner))
      block.chart.series.forEach(s => { add(s, 'name', `${target}/系列${s.id}`, owner); add(s, 'color', `${target}/系列${s.id}`, owner, 'fill') })
    } else if (block.type === 'table') {
      add(block, 'caption', target, owner); block.columns.forEach(c => add(c, 'header', `${target}/${c.id}`, owner))
      block.rows.forEach(r => Object.entries(r.cells).forEach(([id, cell]) => typeof cell === 'string' ? add(r.cells, id, `${target}/${r.id}`, owner) : rich(cell, `${target}/${r.id}/${id}`, owner)))
    } else unsupported.push(`${owner} · ${target}：${block.type} 不支持本次批量修改`)
  })
  const background = (object: object, owner: string, request: EffectiveBackgroundRequest) => {
    const effective = resolveEffectiveBackground(request)
    result.push({ id: `${owner}/backgroundColor/${result.length}`, owner, target: '背景', property: 'backgroundColor', value: effective.color, color: 'background', write(value) {
      bag(object).backgroundColor = value
      if (request.owner !== 'course' && request.owner !== 'slide-state') { bag(object).backgroundMode = 'own'; bag(object).backgroundAssetId = effective.assetId }
    } })
  }
  if (scope === 'course') { document.globalLayerItems.forEach(e => layer(e.item, '整课全局')); background(document, '整课', { owner: 'course', course: document }) }
  document.surfaces.forEach(surface => {
    if (scope !== 'course' && surface.id !== location.surfaceId) return
    const owner = `${surface.title} (${surface.id})`
    // Shared owners are included only by an explicit Surface/course scope.
    if (scope !== 'page') surface.surfaceLayerItems.forEach(e => layer(e.item, `${owner}/共享层`))
    if (scope !== 'page' || surface.type !== 'slide') background(surface, owner, { owner: surface.type === 'slide' ? 'slide-surface' : surface.type === 'flow' ? 'flow-surface' : 'spatial-surface', course: document, surface })
    if (surface.type === 'slide') surface.scenes.forEach(scene => {
      if (scope === 'page' && (location.kind !== 'slide-scene' || scene.id !== location.sceneId)) return
      const sceneOwner = `${owner}/${scene.name}`
      scene.layerItems.forEach(item => layer(item, sceneOwner)); background(scene, sceneOwner, { owner: 'slide-scene', course: document, surface, scene })
      if (scene.presentation?.states.some(s => Object.keys(s.layerItemOverrides).length)) unsupported.push(`${sceneOwner}：演示状态覆盖值不参与批量修改，可能覆盖基础样式`)
    })
    else if (surface.type === 'flow') blocks(surface.blocks, owner)
    else surface.world.layerItems.forEach(item => layer(item, owner))
  })
  return { fields: result, unsupported }
}

export function createProductivityPreview(context: ProductivityContext, request: ProductivityRequest): ProductivityPreview {
  if (request.kind === 'text' && !request.find) throw new Error('请输入查找文字')
  const color = request.kind === 'color' ? context.document.designTokens.colors.find(t => t.id === request.tokenId)?.color : undefined
  if (request.kind === 'color' && !color) throw new Error('项目颜色已失效，请重新选择')
  const collected = fields(context.document, context.sessionToken, request.scope)
  const items = collected.fields.flatMap(field => {
    if (request.kind === 'text' ? field.color || !field.value.includes(request.find) : !field.color || (request.property !== 'all' && field.color !== request.property)) return []
    const newValue = request.kind === 'text' ? field.value.split(request.find).join(request.replacement) : color!
    return newValue === field.value ? [] : [{ id: field.id, target: field.target, owner: field.owner, property: field.property, oldValue: field.value, newValue }]
  })
  return { projectId: context.document.id, revision: context.document.revision, sessionToken: { ...context.sessionToken }, request: { ...request }, items, unsupported: collected.unsupported }
}
export function createTextReplacePreview(context: ProductivityContext, request: Omit<Extract<ProductivityRequest, { kind: 'text' }>, 'kind'>) { return createProductivityPreview(context, { ...request, kind: 'text' }) }
export function createTokenApplyPreview(context: ProductivityContext, request: Omit<Extract<ProductivityRequest, { kind: 'color' }>, 'kind'>) { return createProductivityPreview(context, { ...request, kind: 'color' }) }
export type ProductivityApplyResult = { ok: true; step: EditorTransactionStep | null } | { ok: false; reason: string }
export function applyProductivityPreview(context: ProductivityContext, preview: ProductivityPreview, selectedIds: readonly string[]): ProductivityApplyResult {
  try {
    const token = context.sessionToken, before = preview.sessionToken
    if (context.document.id !== preview.projectId || context.document.revision !== preview.revision || token.generation !== before.generation || token.locationId !== before.locationId || token.surfaceType !== before.surfaceType) throw new Error('预览已过期，请重新预览')
    const fresh = createProductivityPreview(context, preview.request)
    if (JSON.stringify(fresh.items) !== JSON.stringify(preview.items)) throw new Error('内容已变化，请重新预览')
    const selected = new Set(selectedIds)
    if (selected.size !== selectedIds.length || selectedIds.some(id => !fresh.items.some(i => i.id === id))) throw new Error('选择项无效，请重新预览')
    if (!selected.size) return { ok: true, step: null }
    const nextDocument = commitCourseProjectMutation(context.document, draft => {
      const editable = fields(draft, token, preview.request.scope).fields
      fresh.items.filter(i => selected.has(i.id)).forEach(item => editable.find(f => f.id === item.id)!.write(item.newValue, preview.request.kind === 'text' ? preview.request : undefined))
    })
    return { ok: true, step: createEditorTransactionStep(context.document, { projectId: context.document.id, baseRevision: context.document.revision, nextDocument, resourceChanges: {} }) }
  } catch (error) { return { ok: false, reason: error instanceof Error ? error.message : '批量修改失败' } }
}
