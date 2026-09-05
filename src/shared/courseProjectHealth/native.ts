import type {
  CourseProjectDocument,
  NativeLayerItem,
  SlideSceneDocument,
} from '../courseProjectTypes'
import type {
  NativeChartContent,
  NativeInputContent,
  NativeTableContent,
  ShapeNode,
} from '../contracts/native-v1/types'
import type {
  CourseProjectHealthArchiveFiles,
  CourseProjectHealthFindingDraft,
} from './types'
import { allLayerVisits, slideScenes } from './internal'

export function collectCourseProjectNativeHealth(
  project: CourseProjectDocument,
  _archiveFiles: CourseProjectHealthArchiveFiles,
): CourseProjectHealthFindingDraft[] {
  const drafts: CourseProjectHealthFindingDraft[] = []
  const layerVisits = allLayerVisits(project)

  // Map of course state declarations by key
  const stateDeclMap = new Map(project.courseState.map((decl) => [decl.key, decl]))

  // Map of scene interactions by surfaceId:sceneId
  const sceneInteractionMap = new Map<string, Set<string>>()
  slideScenes(project).forEach(({ surface, scene }) => {
    sceneInteractionMap.set(`${surface.id}:${scene.id}`, new Set(scene.interactions.map((r) => r.id)))
  })

  for (const visit of layerVisits) {
    const { item, path, owner } = visit
    if (item.kind !== 'native') continue
    const content = item.content
    const surfaceId = 'surfaceId' in owner ? owner.surfaceId : undefined

    // 1. Native Table
    if (content.nativeType === 'table') {
      const data = content.data as NativeTableContent
      const columnIds = new Set<string>()
      data.columns?.forEach((col, cIdx) => {
        if (columnIds.has(col.id)) {
          drafts.push({
            severity: 'error',
            code: 'table-id-duplicate',
            message: `表格“${item.layerItemId}”存在重复的列 ID：“${col.id}”。`,
            path: [...path, 'content', 'data', 'columns', cIdx, 'id'],
            layerItemId: item.layerItemId,
            ...(surfaceId ? { surfaceId } : {}),
          })
        }
        columnIds.add(col.id)

        if (col.width <= 0 || !Number.isFinite(col.width)) {
          drafts.push({
            severity: 'error',
            code: 'table-dimension-invalid',
            message: `表格“${item.layerItemId}”列“${col.id}”宽度无效（必须为正数）。`,
            path: [...path, 'content', 'data', 'columns', cIdx, 'width'],
            layerItemId: item.layerItemId,
            ...(surfaceId ? { surfaceId } : {}),
          })
        }
      })

      const rowIds = new Set<string>()
      const cellIds = new Set<string>()
      data.rows?.forEach((row, rIdx) => {
        if (rowIds.has(row.id)) {
          drafts.push({
            severity: 'error',
            code: 'table-id-duplicate',
            message: `表格“${item.layerItemId}”存在重复的行 ID：“${row.id}”。`,
            path: [...path, 'content', 'data', 'rows', rIdx, 'id'],
            layerItemId: item.layerItemId,
            ...(surfaceId ? { surfaceId } : {}),
          })
        }
        rowIds.add(row.id)

        if (row.height <= 0 || !Number.isFinite(row.height)) {
          drafts.push({
            severity: 'error',
            code: 'table-dimension-invalid',
            message: `表格“${item.layerItemId}”行“${row.id}”高度无效（必须为正数）。`,
            path: [...path, 'content', 'data', 'rows', rIdx, 'height'],
            layerItemId: item.layerItemId,
            ...(surfaceId ? { surfaceId } : {}),
          })
        }

        if (row.cells && data.columns && row.cells.length !== data.columns.length) {
          drafts.push({
            severity: 'error',
            code: 'table-matrix-mismatch',
            message: `表格“${item.layerItemId}”行“${row.id}”单元格数量 (${row.cells.length}) 与列数 (${data.columns.length}) 不一致。`,
            path: [...path, 'content', 'data', 'rows', rIdx, 'cells'],
            layerItemId: item.layerItemId,
            ...(surfaceId ? { surfaceId } : {}),
          })
        }

        row.cells?.forEach((cell, cIdx) => {
          if (cellIds.has(cell.id)) {
            drafts.push({
              severity: 'error',
              code: 'table-id-duplicate',
              message: `表格“${item.layerItemId}”存在重复的单元格 ID：“${cell.id}”。`,
              path: [...path, 'content', 'data', 'rows', rIdx, 'cells', cIdx, 'id'],
              layerItemId: item.layerItemId,
              ...(surfaceId ? { surfaceId } : {}),
            })
          }
          cellIds.add(cell.id)

          if (!columnIds.has(cell.columnId)) {
            drafts.push({
              severity: 'error',
              code: 'table-matrix-mismatch',
              message: `表格“${item.layerItemId}”单元格“${cell.id}”引用的列 ID“${cell.columnId}”不存在。`,
              path: [...path, 'content', 'data', 'rows', rIdx, 'cells', cIdx, 'columnId'],
              layerItemId: item.layerItemId,
              ...(surfaceId ? { surfaceId } : {}),
            })
          }
        })
      })
    }

    // 2. Native Chart
    if (content.nativeType === 'chart') {
      const data = content.data as NativeChartContent
      const categoryIds = new Set<string>()
      data.categories?.forEach((cat, cIdx) => {
        if (categoryIds.has(cat.id)) {
          drafts.push({
            severity: 'error',
            code: 'chart-id-duplicate',
            message: `图表“${item.layerItemId}”存在重复的分类 ID：“${cat.id}”。`,
            path: [...path, 'content', 'data', 'categories', cIdx, 'id'],
            layerItemId: item.layerItemId,
            ...(surfaceId ? { surfaceId } : {}),
          })
        }
        categoryIds.add(cat.id)
      })

      const seriesIds = new Set<string>()
      const pointIds = new Set<string>()
      data.series?.forEach((s, sIdx) => {
        if (seriesIds.has(s.id)) {
          drafts.push({
            severity: 'error',
            code: 'chart-id-duplicate',
            message: `图表“${item.layerItemId}”存在重复的系列 ID：“${s.id}”。`,
            path: [...path, 'content', 'data', 'series', sIdx, 'id'],
            layerItemId: item.layerItemId,
            ...(surfaceId ? { surfaceId } : {}),
          })
        }
        seriesIds.add(s.id)

        if (data.categories && s.points && s.points.length !== data.categories.length) {
          drafts.push({
            severity: 'error',
            code: 'chart-series-points-mismatch',
            message: `图表“${item.layerItemId}”系列“${s.name || s.id}”数据点数量 (${s.points.length}) 与分类数量 (${data.categories.length}) 不一致。`,
            path: [...path, 'content', 'data', 'series', sIdx, 'points'],
            layerItemId: item.layerItemId,
            ...(surfaceId ? { surfaceId } : {}),
          })
        }

        s.points?.forEach((pt, pIdx) => {
          if (pointIds.has(pt.id)) {
            drafts.push({
              severity: 'error',
              code: 'chart-id-duplicate',
              message: `图表“${item.layerItemId}”存在重复的数据点 ID：“${pt.id}”。`,
              path: [...path, 'content', 'data', 'series', sIdx, 'points', pIdx, 'id'],
              layerItemId: item.layerItemId,
              ...(surfaceId ? { surfaceId } : {}),
            })
          }
          pointIds.add(pt.id)

          if (!categoryIds.has(pt.categoryId)) {
            drafts.push({
              severity: 'error',
              code: 'chart-series-points-mismatch',
              message: `图表“${item.layerItemId}”系列“${s.name || s.id}”数据点引用的分类 ID“${pt.categoryId}”不存在。`,
              path: [...path, 'content', 'data', 'series', sIdx, 'points', pIdx, 'categoryId'],
              layerItemId: item.layerItemId,
              ...(surfaceId ? { surfaceId } : {}),
            })
          }

          if (!Number.isFinite(pt.value)) {
            drafts.push({
              severity: 'error',
              code: 'chart-numeric-value-invalid',
              message: `图表“${item.layerItemId}”系列“${s.name || s.id}”数据点数值无效（必须为有限数字）。`,
              path: [...path, 'content', 'data', 'series', sIdx, 'points', pIdx, 'value'],
              layerItemId: item.layerItemId,
              ...(surfaceId ? { surfaceId } : {}),
            })
          }
        })
      })

      if (data.chartType === 'pie' || data.chartType === 'donut') {
        if (data.series && data.series.length !== 1) {
          drafts.push({
            severity: 'error',
            code: 'chart-pie-single-series',
            message: `饼图/环形图“${item.layerItemId}”只能包含恰好 1 个系列。`,
            path: [...path, 'content', 'data', 'series'],
            layerItemId: item.layerItemId,
            ...(surfaceId ? { surfaceId } : {}),
          })
        }
      }

      if (data.chartType === 'donut') {
        const style = data.style as { holeSize?: number }
        if (style?.holeSize !== undefined && (style.holeSize < 10 || style.holeSize > 90 || !Number.isFinite(style.holeSize))) {
          drafts.push({
            severity: 'error',
            code: 'chart-donut-hole-size-invalid',
            message: `环形图“${item.layerItemId}”中心孔径比例无效（必须介于 10 与 90 之间）。`,
            path: [...path, 'content', 'data', 'style', 'holeSize'],
            layerItemId: item.layerItemId,
            ...(surfaceId ? { surfaceId } : {}),
          })
        }
      }
    }

    // 3. Native Input
    if (content.nativeType === 'input') {
      const data = content.data as NativeInputContent
      if (owner.kind !== 'scene') {
        drafts.push({
          severity: 'error',
          code: 'input-container-invalid',
          message: `原生输入框“${item.layerItemId}”只允许放在 Slide 场景中。`,
          path: [...path, 'content', 'nativeType'],
          layerItemId: item.layerItemId,
          ...(surfaceId ? { surfaceId } : {}),
        })
      }

      const stateDecl = stateDeclMap.get(data.stateKey)
      if (!stateDecl) {
        drafts.push({
          severity: 'error',
          code: 'input-state-key-invalid',
          message: `输入框“${item.layerItemId}”绑定的值状态键“${data.stateKey}”在工程状态声明中不存在。`,
          path: [...path, 'content', 'data', 'stateKey'],
          layerItemId: item.layerItemId,
          ...(surfaceId ? { surfaceId } : {}),
        })
      } else if (data.answerType === 'number' && stateDecl.valueType !== 'number') {
        drafts.push({
          severity: 'error',
          code: 'input-state-key-invalid',
          message: `数值输入框“${item.layerItemId}”绑定的值状态键“${data.stateKey}”声明类型不是 number。`,
          path: [...path, 'content', 'data', 'stateKey'],
          layerItemId: item.layerItemId,
          ...(surfaceId ? { surfaceId } : {}),
        })
      }

      const validDecl = stateDeclMap.get(data.validityKey)
      if (!validDecl) {
        drafts.push({
          severity: 'error',
          code: 'input-state-key-invalid',
          message: `输入框“${item.layerItemId}”绑定的有效性键“${data.validityKey}”在工程状态声明中不存在。`,
          path: [...path, 'content', 'data', 'validityKey'],
          layerItemId: item.layerItemId,
          ...(surfaceId ? { surfaceId } : {}),
        })
      } else if (validDecl.valueType !== 'boolean') {
        drafts.push({
          severity: 'error',
          code: 'input-state-key-invalid',
          message: `输入框“${item.layerItemId}”绑定的有效性键“${data.validityKey}”声明类型不是 boolean。`,
          path: [...path, 'content', 'data', 'validityKey'],
          layerItemId: item.layerItemId,
          ...(surfaceId ? { surfaceId } : {}),
        })
      }

      if (owner.kind === 'scene') {
        const sceneRules = sceneInteractionMap.get(`${owner.surfaceId}:${owner.sceneId}`)
        data.ruleFamilyRuleIds?.forEach((ruleId, rIdx) => {
          if (!sceneRules?.has(ruleId)) {
            drafts.push({
              severity: 'error',
              code: 'input-rule-family-incomplete',
              message: `输入框“${item.layerItemId}”绑定的规则族规则“${ruleId}”在场景交互中不存在。`,
              path: [...path, 'content', 'data', 'ruleFamilyRuleIds', rIdx],
              layerItemId: item.layerItemId,
              ...(surfaceId ? { surfaceId } : {}),
            })
          }
        })
      }
    }

    // 4. Line / Shape Geometry
    if (content.nativeType === 'shape') {
      const data = content.data as ShapeNode
      if (data.lineGeometry) {
        if (data.shapeType !== 'line' && data.shapeType !== 'elbow-arrow') {
          drafts.push({
            severity: 'error',
            code: 'line-geometry-shape-mismatch',
            message: `图形“${item.layerItemId}”类型为“${data.shapeType}”，不允许携带线条几何参数。`,
            path: [...path, 'content', 'data', 'lineGeometry'],
            layerItemId: item.layerItemId,
            ...(surfaceId ? { surfaceId } : {}),
          })
        } else if (data.shapeType === 'line' && data.lineGeometry.kind !== 'straight') {
          drafts.push({
            severity: 'error',
            code: 'line-geometry-shape-mismatch',
            message: `直线“${item.layerItemId}”只能使用 straight 几何参数。`,
            path: [...path, 'content', 'data', 'lineGeometry', 'kind'],
            layerItemId: item.layerItemId,
            ...(surfaceId ? { surfaceId } : {}),
          })
        } else if (data.shapeType === 'elbow-arrow' && data.lineGeometry.kind !== 'elbow') {
          drafts.push({
            severity: 'error',
            code: 'line-geometry-shape-mismatch',
            message: `折线箭头“${item.layerItemId}”只能使用 elbow 几何参数。`,
            path: [...path, 'content', 'data', 'lineGeometry', 'kind'],
            layerItemId: item.layerItemId,
            ...(surfaceId ? { surfaceId } : {}),
          })
        } else {
          // Check degenerate path
          const { start, end } = data.lineGeometry
          if (start && end && start[0] === end[0] && start[1] === end[1]) {
            drafts.push({
              severity: 'warning',
              code: 'line-path-degenerate',
              message: `线条“${item.layerItemId}”起点与终点重合，长度为零。`,
              path: [...path, 'content', 'data', 'lineGeometry'],
              layerItemId: item.layerItemId,
              ...(surfaceId ? { surfaceId } : {}),
            })
          }
        }
      }
    }
  }

  // 5. Background asset presence check
  const checkBackgroundAsset = (
    assetId: string | null | undefined,
    path: Array<string | number>,
    label: string,
    surfaceId?: string,
  ) => {
    if (!assetId) return
    if (!project.assets[assetId]) {
      drafts.push({
        severity: 'error',
        code: 'background-asset-missing',
        message: `${label}引用的素材“${assetId}”不存在。`,
        path,
        ...(surfaceId ? { surfaceId } : {}),
      })
    }
  }

  checkBackgroundAsset(project.backgroundAssetId, ['backgroundAssetId'], '课程背景')
  project.surfaces.forEach((surface, sIdx) => {
    checkBackgroundAsset(surface.backgroundAssetId, ['surfaces', sIdx, 'backgroundAssetId'], 'Surface 背景', surface.id)
  })
  slideScenes(project).forEach(({ surface, scene, path }) => {
    checkBackgroundAsset(scene.backgroundAssetId, [...path, 'backgroundAssetId'], '场景背景', surface.id)
    scene.presentation?.states.forEach((state, stIdx) => {
      checkBackgroundAsset(state.backgroundAssetId, [...path, 'presentation', 'states', stIdx, 'backgroundAssetId'], '状态背景', surface.id)
    })
  })

  return drafts
}
