import { nanoid } from 'nanoid'
import type { NativeChartContent } from '../../shared/contracts/native-v1'

export function rebuildChartItemIds(
  content: NativeChartContent,
  idFactory: (() => string) = nanoid,
): NativeChartContent {
  const catIdMap = new Map<string, string>()
  const nextCategories = content.categories.map((cat) => {
    const newId = `cat_${idFactory()}`
    catIdMap.set(cat.id, newId)
    return { ...cat, id: newId }
  })
  const nextSeries = content.series.map((ser) => {
    const newSerId = `ser_${idFactory()}`
    const nextPoints = ser.points.map((pt) => {
      const newPtId = `pt_${idFactory()}`
      const newCatId = catIdMap.get(pt.categoryId) ?? pt.categoryId
      return {
        ...pt,
        id: newPtId,
        categoryId: newCatId,
      }
    })
    return {
      ...ser,
      id: newSerId,
      points: nextPoints,
    }
  })
  return {
    ...content,
    categories: nextCategories,
    series: nextSeries as typeof content.series,
    style: { ...content.style },
  } as NativeChartContent
}
