import type { LayerItem } from '../../shared/courseProjectTypes'
import { rebuildTableItemIds } from './nativeNodeFactories'
import { rebuildChartItemIds } from './chartIdentity'

export function cloneDuplicatedLayerItem(item: LayerItem, nextId: string): LayerItem {
  const duplicate = structuredClone(item)
  duplicate.layerItemId = nextId
  duplicate.label = `${item.label} 副本`.slice(0, 200)
  duplicate.frame.x += 20
  duplicate.frame.y += 20
  duplicate.locked = false
  if (duplicate.kind === 'native') {
    if (duplicate.content.nativeType === 'table') {
      duplicate.content.data = rebuildTableItemIds(duplicate.content.data)
    } else if (duplicate.content.nativeType === 'chart') {
      duplicate.content.data = rebuildChartItemIds(duplicate.content.data)
    }
  }
  return duplicate
}
