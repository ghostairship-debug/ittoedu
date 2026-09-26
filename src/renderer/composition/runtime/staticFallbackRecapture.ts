import { nanoid } from 'nanoid'
import { locateCourseLayer } from '../../../core/drivers/course/layerProperties'
import type { AssetMeta } from '../../../shared/contracts/media-v1'
import { capturePublishedCourseV2Stage } from '../../export/playerCapture'
import { selectActiveCourseLocationId, selectActiveCourseProjectDocument, selectMediaAssetFiles, useEditorStore } from '../../store/editorStore'
import { buildPublishedCourseTryRunPayload } from '../../ui/coursePlayerTryRun'

/**
 * M15: after the teacher changes text a Runtime or component renders itself, its static fallback (used by
 * thumbnails, static export and when it cannot run) is captured again from how it looks now. Edits in quick
 * succession are captured once, when they settle.
 */
const pending = new Map<string, ReturnType<typeof setTimeout>>()
const SETTLE_MS = 1500

function pngSize(bytes: Uint8Array): { width: number; height: number } {
  // IHDR: width and height are big-endian at bytes 16–23.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  return bytes.byteLength >= 24 ? { width: view.getUint32(16), height: view.getUint32(20) } : { width: 1, height: 1 }
}
function dataUrlBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  const binary = atob(base64)
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

/** Captures one layer item of the open course as it renders now, as a new managed PNG. */
export async function captureLayerStaticFallback(itemId: string): Promise<{ meta: AssetMeta; bytes: Uint8Array } | null> {
  const state = useEditorStore.getState()
  const project = selectActiveCourseProjectDocument(state), locationId = selectActiveCourseLocationId(state)
  const located = project ? locateCourseLayer(project, itemId) : null
  if (!project || !locationId || !located) return null
  // Only an existing fallback is refreshed; items without one are not captured at all.
  const hasFallback = located.item.kind === 'runtime' ? Boolean(located.item.runtime.staticFallback)
    : located.item.kind === 'component' && Boolean(located.item.staticFallbackAssetId)
  if (!hasFallback) return null
  const location = project.locations.find(item => item.id === locationId)
  const payload = buildPublishedCourseTryRunPayload({ project, assetFiles: selectMediaAssetFiles(state), components: state.componentPackages })
  const dataUrl = await capturePublishedCourseV2Stage({ payload, locationId, ...(location?.surfaceId ? { surfaceId: location.surfaceId } : {}), layerItemId: itemId, includeGlobalLayerItems: true })
  if (!dataUrl.startsWith('data:image/png')) return null
  const bytes = dataUrlBytes(dataUrl), id = `fallback-${itemId}-${nanoid(8)}`
  return { bytes, meta: { id, filename: `${id}.png`, mimeType: 'image/png', kind: 'image', path: `assets/${id}.png`, byteLength: bytes.byteLength, ...pngSize(bytes) } }
}

/** Schedules the capture of an item's static fallback once its text edits settle; items without a fallback are left alone. */
export function scheduleStaticFallbackRecapture(itemId: string): void {
  const previous = pending.get(itemId)
  if (previous) clearTimeout(previous)
  pending.set(itemId, setTimeout(() => {
    pending.delete(itemId)
    void (async () => {
      const captured = await captureLayerStaticFallback(itemId)
      if (!captured) return
      const result = useEditorStore.getState().refreshStaticFallback(itemId, captured.meta, captured.bytes)
      if (!result.ok) console.warn(`静态后备图没有更新：${result.reason}`)
    })().catch(error => console.warn('静态后备图重新截取失败', error))
  }, SETTLE_MS))
}
