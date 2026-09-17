import type { GenerationTaskFacts } from './generationTaskFacts'

export type SlideInteractionTargetIndex = GenerationTaskFacts['indexes'][number]

export type SlideInteractionTargetResolution =
  | { status: 'resolved'; itemId: string }
  | { status: 'deferred'; message: string }
  | { status: 'error'; code: 'compose-node-ambiguous' | 'compose-node-not-found'; message: string; path: (string | number)[] }

/**
 * Resolve an interaction node against one location's applicable item index.
 * The resolver has no document or Store dependency so frozen preflight and the
 * live authoring command use the same ID-first/unique-label rule.
 */
export function resolveSlideInteractionTarget(input: {
  index: SlideInteractionTargetIndex | undefined
  reference: string
  what: string
  path: (string | number)[]
}): SlideInteractionTargetResolution {
  const { index, reference, what, path } = input
  if (!index || index.scope !== 'applicable-location-items' || index.completeness !== 'complete') {
    return { status: 'deferred', message: '当前位置索引不完整，交由宿主依据当前工程解析目标。' }
  }
  const byId = index.items.filter(item => item.id === reference)
  if (byId.length === 1) return { status: 'resolved', itemId: byId[0]!.id }
  if (byId.length > 1) {
    return { status: 'error', code: 'compose-node-ambiguous',
      message: `${what}“${reference}”匹配到多个同名图层，请改用图层 id`, path }
  }
  const matches = index.items.filter(item => item.label === reference)
  if (matches.length === 1) return { status: 'resolved', itemId: matches[0]!.id }
  if (matches.length > 1) {
    return { status: 'error', code: 'compose-node-ambiguous',
      message: `${what}“${reference}”匹配到多个同名图层，请改用图层 id`, path }
  }
  return { status: 'error', code: 'compose-node-not-found',
    message: `${what}“${reference}”在当前位置不存在；请先创建该图层或使用已有图层的 id / 唯一名称`, path }
}
