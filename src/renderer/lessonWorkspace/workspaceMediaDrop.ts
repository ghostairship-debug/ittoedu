import type { WorkspaceMediaFile } from '../../shared/workbench/workspaceFiles'
import type { WorkspaceMediaSource } from './workspaceMediaSourceContext'
import { readWorkspaceMediaDrag } from './workspaceMediaDrag'

export type WorkspaceMediaPlacement =
  | { surface: 'slide' | 'spatial'; x: number; y: number }
  | { surface: 'flow'; afterBlockId: string | null }

export interface WorkspaceMediaDropTarget {
  documentId: string | null
  projectId: string
  revision: number
  locationId: string
  surfaceId: string
  sessionGeneration: number
}

export interface WorkspaceMediaDropRequest {
  items: readonly WorkspaceMediaFile[]
  placement: WorkspaceMediaPlacement
  target: WorkspaceMediaDropTarget
}

export type WorkspaceMediaDropHandler = (request: WorkspaceMediaDropRequest) => Promise<{ ok: boolean; reason?: string }>

export async function deliverWorkspaceMediaDrop(
  raw: string,
  source: WorkspaceMediaSource,
  placement: WorkspaceMediaPlacement,
  target: WorkspaceMediaDropTarget,
  commit: WorkspaceMediaDropHandler,
  isCurrentSource?: () => boolean,
): Promise<{ ok: boolean; reason?: string }> {
  if (!source.directory || !source.files) return { ok: false, reason: '请先打开已授权的工作空间' }
  try {
    const items = await readWorkspaceMediaDrag(raw, source.directory, source.files)
    if (!items?.length) return { ok: false, reason: '请从资源管理器拖入媒体文件' }
    if (isCurrentSource && !isCurrentSource()) return { ok: false, reason: '工作空间已切换，请重新拖入媒体' }
    return await commit({ items, placement, target })
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : '媒体拖入失败' }
  }
}
