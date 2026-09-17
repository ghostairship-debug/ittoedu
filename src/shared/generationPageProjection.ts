function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

/** Keep the full page in project/targets.json while exposing only navigation
 * and item/block identities inline for non-active course locations. */
export function compactGenerationPage(page: unknown): Record<string, unknown> {
  const source = record(page)
  if (!Array.isArray(source.items) && !Array.isArray(source.blocks) && source.summary && source.details) return source
  const items = Array.isArray(source.items) ? source.items : []
  const blocks = Array.isArray(source.blocks) ? source.blocks : []
  return {
    location: source.location,
    surfaceType: source.surfaceType,
    ...(source.canvas ? { canvas: source.canvas } : {}),
    ...(source.layout ? { layout: source.layout } : {}),
    summary: {
      itemCount: items.length,
      blockCount: blocks.length,
      items: items.map(row => {
        const item = record(record(row).item)
        return { id: item.layerItemId, label: item.label, kind: item.kind,
          ...(item.kind === 'native' ? { nativeType: record(item.content).nativeType } : {}) }
      }),
      blocks: blocks.map(row => {
        const block = record(record(row).block)
        return { id: block.id, label: block.label, type: block.type }
      }),
    },
    details: { source: 'resources/project/targets.json', locationId: record(source.location).id,
      instruction: '本位置只保留导航和摘要；需要正文、属性、背景或完整目标时读取该资源中的同 locationId 页面。' },
  }
}
