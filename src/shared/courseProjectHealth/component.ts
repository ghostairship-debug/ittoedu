import type { CourseProjectDocument } from '../courseProjectTypes'
import {
  finalizeCourseProjectHealthFindings,
  visitCourseFlowBlocks,
  visitCourseLayerItems,
} from './internal'
import type {
  CourseProjectHealthArchiveFiles,
  CourseProjectHealthFinding,
  CourseProjectHealthFindingDraft,
} from './types'

export function collectCourseProjectComponentHealth(
  project: CourseProjectDocument,
  _archiveFiles: CourseProjectHealthArchiveFiles,
): CourseProjectHealthFinding[] {
  const drafts: CourseProjectHealthFindingDraft[] = []
  const used = new Set<string>()
  visitCourseLayerItems(project, ({ item }) => {
    if (item.kind === 'component') used.add(item.component.packageId)
  })
  visitCourseFlowBlocks(project, ({ block }) => {
    if (block.type === 'component') used.add(block.component.packageId)
  })

  Object.entries(project.componentPackages).forEach(([packageKey, metadata]) => {
    const base = ['componentPackages', packageKey] as Array<string | number>
    const common = {
      path: base,
    }
    if (!metadata.thumbnailPath) {
      drafts.push({
        severity: 'warning',
        code: 'component-thumbnail-missing',
        message: `组件包“${metadata.name}”没有缩略图，组件库只能显示通用占位图。`,
        ...common,
        path: [...base, 'thumbnailPath'],
      })
    }
    if (!metadata.sha256) {
      drafts.push({
        severity: 'warning',
        code: 'component-package-hash-missing',
        message: `组件包“${metadata.name}”没有记录原始包 SHA-256，无法追溯最初选取的包字节。`,
        ...common,
        path: [...base, 'sha256'],
      })
    }
    if (!metadata.sourceLabel) {
      drafts.push({
        severity: 'info',
        code: 'component-package-source-missing',
        message: `组件包“${metadata.name}”没有可读来源记录，后续审阅和更新难以追溯。`,
        ...common,
        path: [...base, 'sourceLabel'],
      })
    }
    if (!used.has(metadata.packageId)) {
      drafts.push({
        severity: 'info',
        code: 'component-package-unused',
        message: `组件包“${metadata.packageId}”当前没有任何 V9 图层或 Flow 组件块引用。`,
        ...common,
      })
    }
  })
  return finalizeCourseProjectHealthFindings(project, drafts)
}
