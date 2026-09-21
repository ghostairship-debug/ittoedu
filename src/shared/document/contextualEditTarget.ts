import { documentRefKey, type ContextualEditTarget, type DocumentFileRef, type DocumentFileVersion } from './ports'

export function freezeContextualEditTarget(target: ContextualEditTarget): ContextualEditTarget {
  const freeze = <T>(value: T): T => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value) }; return value }
  return freeze(structuredClone(target))
}
export function validateContextualEditTarget(target: ContextualEditTarget, current: { ref: DocumentFileRef; source: string; version: DocumentFileVersion; epoch: number }): void {
  if (documentRefKey(target.ref) !== documentRefKey(current.ref) || target.epoch !== current.epoch) throw new Error('文档目标已关闭或切换，请重新选择内容。')
  if (target.source !== current.source || JSON.stringify(target.baseVersion) !== JSON.stringify(current.version)) throw new Error('当前文档已改变，请重新选择内容后再发送。')
  if (!target.ranges?.length) throw new Error(target.message ?? '当前选区无法精确定位，请在源文中选择范围。')
  let end = -1
  for (const range of target.ranges) {
    if (!Number.isInteger(range.from) || !Number.isInteger(range.to) || range.from < 0 || range.from < end || range.to < range.from || range.to > current.source.length || current.source.slice(range.from, range.to) !== range.before) throw new Error('当前选区已失效，请重新选择内容后再发送。')
    end = range.to
  }
}
