import { createMediaAssetImport, readMediaMetadata } from './assetManager'
import type { CourseImportedAsset } from './v9AssetAdapter'
import { pptxReject, pptxRelationshipId, xmlFirst, xmlAll, xmlChildren, type PptxPackage } from './pptxPackage'
import { nanoid } from 'nanoid'
import type { LayerItem } from '../../shared/courseProjectTypes'
import type { InteractionRule } from '../../shared/contracts/interaction-v1/types'

const mimeTypes: Record<string, string> = { mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4' }

/** Resolve and decode embedded media before admitting it to the import transaction. */
export async function parsePptxMediaAsset(
  object: Element, pkg: PptxPackage, sourcePath: string,
  assetsByPath: Map<string, CourseImportedAsset>,
): Promise<CourseImportedAsset | undefined> {
  const video = xmlFirst(object, 'videoFile') ?? xmlFirst(object, 'audioFile')
  const kind = video?.localName === 'audioFile' ? 'audio' : 'video'
  if (!video) return undefined
  const embedded = xmlFirst(object, 'media')
  const relationshipId = embedded && pptxRelationshipId(embedded, 'embed') || pptxRelationshipId(video, 'link')
  const relationship = pkg.relationships(sourcePath).find(entry => entry.id === relationshipId)
  if (!relationship) pptxReject('媒体', '内嵌媒体关系缺失')
  if (relationship.external) pptxReject('外链媒体', '未下载外部媒体；请在源文件中嵌入媒体后重试')
  if (!relationship.type.endsWith(`/${kind}`) && !relationship.type.endsWith('/media')) pptxReject('媒体', '内嵌媒体关系类型错误')
  const bytes = pkg.files[relationship.target]
  if (!bytes?.byteLength) pptxReject('媒体', '内嵌媒体文件缺失或为空')
  const mimeType = mimeTypes[relationship.target.split('.').pop()?.toLowerCase() ?? '']
  if (!mimeType || !mimeType.startsWith(`${kind}/`)) pptxReject('媒体编码', '当前仅支持浏览器可解码的 MP4 / WebM 视频及 MP3 / WAV / OGG / M4A 音频')
  const existing = assetsByPath.get(relationship.target)
  if (existing) return existing
  try {
    const metadata = await readMediaMetadata(bytes, mimeType, kind)
    const asset = createMediaAssetImport({ name: relationship.target.split('/').pop()!, mimeType, bytes }, kind, metadata)
    assetsByPath.set(relationship.target, asset)
    return asset
  } catch {
    return pptxReject('媒体编码', '浏览器无法解码此内嵌媒体；请重新编码为受支持音视频格式后重试')
  }
}

/** Only independent object-click visibility sets have an exact existing interaction equivalent.
 * All-or-nothing per timing tree prevents partially applying a dependent animation sequence.
 */
export function parsePptxVisibilityEffects(slide: Document, objects: Map<string, LayerItem[]>): InteractionRule[] | undefined {
  const timing = xmlFirst(slide, 'timing')
  if (!timing) return []
  const sets = xmlAll(timing, 'set')
  const allowedElements = new Set(['tnLst', 'par', 'cTn', 'childTnLst', 'set', 'cBhvr', 'stCondLst', 'cond', 'tgtEl', 'spTgt', 'attrNameLst', 'attrName', 'to', 'strVal'])
  if (!sets.length || Array.from(timing.getElementsByTagName('*')).some(node => !allowedElements.has(node.localName))) return undefined
  for (const time of xmlAll(timing, 'cTn')) {
    if (['repeatCount', 'repeatDur', 'autoRev', 'speed', 'accel', 'decel', 'restart', 'endSync', 'afterEffect'].some(name => time.hasAttribute(name))) return undefined
  }
  const rules: InteractionRule[] = []
  const entrances: LayerItem[] = []
  const targets = new Set<string>()
  for (const set of sets) {
    const behavior = xmlFirst(set, 'cBhvr')
    const targetElement = behavior && xmlChildren(behavior).find(node => node.localName === 'tgtEl')
    const target = targetElement && xmlFirst(targetElement, 'spTgt')
    const targetId = target?.getAttribute('spid') ?? ''
    const items = objects.get(targetId)
    const attrs = behavior && xmlAll(behavior, 'attrName')
    const value = xmlFirst(set, 'strVal')?.getAttribute('val')
    if (!items?.length || !target || xmlChildren(target).length || targets.has(targetId) || attrs?.length !== 1 || attrs[0].textContent !== 'style.visibility' || !['visible', 'hidden'].includes(value ?? '')) return undefined
    targets.add(targetId)
    const ownTime = behavior && xmlFirst(behavior, 'cTn')
    if (!ownTime || !['0', '1'].includes(ownTime.getAttribute('dur') ?? '') || ownTime.getAttribute('fill') !== 'hold') return undefined
    let ancestor: Element | null = set
    let condition: Element | undefined
    while (ancestor && ancestor !== timing) {
      const time = ancestor.localName === 'cTn' ? ancestor : undefined
      const conditions = time && xmlChildren(time).find(node => node.localName === 'stCondLst')
      if (conditions) {
        const entries = xmlChildren(conditions)
        if (entries.length !== 1) return undefined
        const entry = entries[0]
        if (entry.getAttribute('evt')) { if (condition) return undefined; condition = entry }
        else if (!['0', ''].includes(entry.getAttribute('delay') ?? '')) return undefined
      }
      if (time && ['repeatCount', 'repeatDur', 'autoRev', 'speed', 'accel', 'decel', 'restart'].some(name => time.hasAttribute(name))) return undefined
      ancestor = ancestor.parentElement
    }
    // A condition on cBhvr's own time is also legal.
    const direct = xmlAll(ownTime, 'cond')
    if (direct.length) { if (condition || direct.length !== 1) return undefined; condition = direct[0] }
    if (!condition || condition.getAttribute('evt') !== 'onClick' || !['0', ''].includes(condition.getAttribute('delay') ?? '')) return undefined
    const triggerId = xmlFirst(condition, 'spTgt')?.getAttribute('spid') ?? ''
    const triggers = objects.get(triggerId)
    if (!triggers?.length || (value === 'visible' && triggerId === targetId)) return undefined
    if (value === 'visible') entrances.push(...items)
    for (const trigger of triggers) rules.push({ id: `rule_${nanoid()}`, name: '导入点击显隐', enabled: true,
      trigger: { type: 'node.click', nodeId: trigger.layerItemId }, conditions: [],
      actions: items.map((item, index) => ({ id: `action_${nanoid()}`, start: index === 0 ? 'after-previous' : 'with-previous', delayMs: 0,
        action: { type: value === 'visible' ? 'node.enter' : 'node.exit', nodeId: item.layerItemId, durationMs: 0, easing: 'linear', effect: 'none' } })),
    })
  }
  for (const item of entrances) item.playbackInitialVisibility = 'hidden'
  return rules
}
