import { useCallback, useRef, useState } from 'react'
import type { AssetMeta } from '../../shared/contracts/media-v1/types'
import type { SelectedFileBatch, SelectedImageResult, SelectedImageBatchFile, SelectedMediaResult, SelectedMediaBatchFile } from '../../shared/ipcTypes'
import type { WorkspaceMediaDropRequest } from '../lessonWorkspace/workspaceMediaDrop'
import type { EditorStoreKernel } from '../store/editorStoreKernel'
import type { CapturedCourseTarget } from '../documents/CourseV10DocumentBridge'
import { createImageAssetImport, createMediaAssetImport, readImageDimensions, readMediaMetadata, type ImportedImageAsset } from '../project/assetManager'
import { captureCourseInsertionTarget, importCourseMediaLibrary, insertCourseMedia, replaceCourseImageAtTarget,
  importCourseSounds, replaceCourseMediaAtTarget, type ImportedAssetBatchItem, type CourseInsertionOptions } from '../media/commitCourseMediaAuthoring'

export interface MediaImportItem extends ImportedAssetBatchItem {}
export interface MediaImportIssue { readonly name: string; readonly message: string }
export interface PreparedTargetMedia {
  readonly asset: import('../../shared/contracts/component-platform/project').ComponentAsset
  readonly bytes: Uint8Array
  readonly source: { readonly kind: 'existing'; readonly assetId: string } | { readonly kind: 'new'; readonly meta: AssetMeta; readonly bytes: Uint8Array }
  assertCurrent(): void
}
export interface TargetMediaSelection<T extends object> {
  readonly kind: 'image' | 'video' | 'audio'
  captureTarget(): T | null
  isTargetCurrent(target: Readonly<T>): boolean
}
/** Desktop pickers remain caller-owned; formal resources and placement have one Kernel writer. */
export interface MediaImportPorts {
  kernel: EditorStoreKernel
  capturePlacement?(target: CapturedCourseTarget): CourseInsertionOptions
  selectImage(): Promise<SelectedImageResult | null>
  selectImages(): Promise<SelectedFileBatch<SelectedImageBatchFile> | null>
  selectAudios(): Promise<SelectedFileBatch<SelectedMediaBatchFile> | null>
  selectAudio?(): Promise<SelectedMediaResult | null>
  selectVideos(): Promise<SelectedFileBatch<SelectedMediaBatchFile> | null>
  selectVideo?(): Promise<SelectedMediaResult | null>
  runBusy<T>(operation: () => Promise<T>, fallback: string): Promise<T | undefined>
  commitStatus(message: string | null): void
  reportError(message: string): void
}
export interface MediaImportApi {
  selectAndImportImage(mode: 'add' | 'library' | 'replace', position?: { x?: number; y?: number }): Promise<void>
  selectAndImportVideo(mode: 'add' | 'library', position?: { x?: number; y?: number }): Promise<void>
  selectAndImportAudio(): Promise<void>
  replaceSelectedVideo(): Promise<void>
  selectAndInsertFlowAudio(): Promise<void>
  importWorkspaceMedia(request: WorkspaceMediaDropRequest): Promise<{ ok: boolean; reason?: string; assetId?: string; soundId?: string }>
  selectImageAsset(): Promise<ImportedImageAsset | null>
  selectVideoAsset(): Promise<MediaImportItem | null>
  selectAudioAsset(): Promise<MediaImportItem | null>
  selectMediaAsset(kind: 'image' | 'video' | 'audio'): Promise<MediaImportItem | null>
  selectTargetMedia<T extends object>(input: TargetMediaSelection<T>): Promise<PreparedTargetMedia | null>
  batchOperationSummary: { title: string; summary: string } | null
  clearBatchSummary(): void
}
async function prepare(file: Pick<SelectedMediaResult, 'name' | 'mimeType' | 'bytes'>, kind: 'image' | 'video' | 'audio'): Promise<MediaImportItem> {
  if (kind === 'image') return createImageAssetImport(file, { dimensions: await readImageDimensions(file.bytes, file.mimeType) })
  return createMediaAssetImport(file, kind, await readMediaMetadata(file.bytes, file.mimeType, kind))
}
/** Original imported filename is preserved in the managed path; the ID remains software-owned. */
function namedAsset(item: MediaImportItem): MediaImportItem {
  const safe = item.meta.filename.replace(/[\\/:*?"<>|]/g, '_')
  return { ...item, meta: { ...item.meta, path: `assets/${item.meta.id}/${safe}`,
    source: item.meta.source ?? { kind: 'user-material', title: item.meta.filename } } }
}
export function useMediaImport(ports: MediaImportPorts): MediaImportApi {
  const current = useRef(ports); current.current = ports
  const [batchOperationSummary, setBatchOperationSummary] = useState<{ title: string; summary: string } | null>(null)
  const summarize = useCallback((title: string, completed: number, issues: MediaImportIssue[]) => {
    const summary = [`已完成 ${completed} 项`, ...issues.map(issue => `${issue.name}：${issue.message}`)].join('\n')
    setBatchOperationSummary({ title, summary }); current.current.commitStatus(`${title}：已完成 ${completed} 项`)
    if (issues.length) current.current.reportError(issues.map(issue => `${issue.name}：${issue.message}`).join('\n'))
  }, [])
  const batch = useCallback(async (kind: 'image' | 'video' | 'audio', mode: 'add' | 'library', position?: { x?: number; y?: number }) => {
    await current.current.runBusy(async () => {
      const owner = current.current, target = captureCourseInsertionTarget(owner.kernel)
      const placement = { ...owner.capturePlacement?.(target), ...position }
      const selected = await (kind === 'image' ? owner.selectImages() : kind === 'video' ? owner.selectVideos() : owner.selectAudios())
      if (!selected) return
      const issues: MediaImportIssue[] = selected.rejected.map(issue => ({ name: issue.name, message: `${issue.message} ${issue.suggestion}` }))
      const items: MediaImportItem[] = []
      for (const file of selected.accepted) {
        try { items.push(namedAsset(await prepare(file, kind))) }
        catch (error) { issues.push({ name: file.name, message: error instanceof Error ? error.message : String(error) }) }
      }
      let completed = 0
      if (items.length) {
        if (mode === 'library') {
          if (kind === 'audio') await importCourseSounds(owner.kernel, target, items)
          else await importCourseMediaLibrary(owner.kernel, target, items)
          completed = items.length
        }
        else {
          try { completed = (await insertCourseMedia(owner.kernel, target, items, placement)).instanceIds.length }
          catch (error) {
            // Keep successfully decoded source resources when placement reports a local failure.
            if (kind !== 'image') await importCourseMediaLibrary(owner.kernel, target, items)
            issues.push({ name: '插入', message: `${error instanceof Error ? error.message : String(error)}${kind !== 'image' ? '；有效素材已保存到原工程媒体库' : ''}` })
          }
        }
      }
      summarize(`${kind === 'image' ? '图片' : kind === 'video' ? '视频' : '音频'}${mode === 'library' ? '入库' : '添加'}`, completed, issues)
    }, '媒体文件读取或提交失败，原内容保留。')
  }, [summarize])
  const selectAndImportImage = useCallback(async (mode: 'add' | 'library' | 'replace', position?: { x?: number; y?: number }) => {
    if (mode !== 'replace') return batch('image', mode, position)
    await current.current.runBusy(async () => {
      const owner = current.current, target = captureCourseInsertionTarget(owner.kernel)
      const selected = await owner.selectImage(); if (!selected) return
      await replaceCourseImageAtTarget(owner.kernel, target, namedAsset(await prepare(selected, 'image')))
      owner.commitStatus('图片已替换，原位置、大小与其他对象保持')
    }, '图片替换失败，原图仍保留。')
  }, [batch])
  const pickAsset = useCallback(async (kind: 'image' | 'video' | 'audio'): Promise<MediaImportItem | null> => {
    return await current.current.runBusy(async () => {
      const owner = current.current
      const selected = kind === 'image' ? await owner.selectImage() : kind === 'video' ? await owner.selectVideo?.() : await owner.selectAudio?.()
      return selected ? namedAsset(await prepare(selected, kind)) : null
    }, '媒体文件读取失败。') ?? null
  }, [])
  const selectTargetMedia = useCallback(async <T extends object>(input: TargetMediaSelection<T>): Promise<PreparedTargetMedia | null> => {
    const target = input.captureTarget(); if (!target) return null
    const item = await pickAsset(input.kind); if (!item) return null
    const assertCurrent = () => { if (!input.isTargetCurrent(target)) throw new Error('捕获的原媒体目标已失效，请重新选择文件') }
    assertCurrent()
    return { asset: { ...item.meta }, bytes: item.bytes,
      source: { kind: 'new', meta: item.meta, bytes: item.bytes }, assertCurrent }
  }, [pickAsset])
  const importWorkspaceMedia = useCallback(async (request: WorkspaceMediaDropRequest) => {
    try {
      const owner = current.current
      if (!request.target.documentId) throw new Error('拖入目标没有正式文档')
      const target = request.target.captured
      if (target.project.id !== request.target.projectId || target.project.revision !== request.target.revision
        || target.surfaceId !== request.target.surfaceId || target.documentId !== request.target.documentId) throw new Error('原拖入目标不一致，请重新拖入')
      const items: MediaImportItem[] = []
      for (const file of request.items) items.push(namedAsset(await prepare(file, file.mediaKind)))
      if (!items.length) return { ok: false, reason: '没有可导入的媒体' }
      const options = request.placement.surface === 'flow'
        ? { afterInstanceId: request.placement.afterBlockId, container: request.placement.container, index: request.placement.index, destination: 'document' as const }
        : request.placement
      try { await insertCourseMedia(owner.kernel, target, items, options) }
      catch (error) {
        if (items.every(item => item.meta.kind !== 'image')) await importCourseMediaLibrary(owner.kernel, target, items)
        throw error
      }
      return { ok: true, assetId: items[0].meta.id }
    } catch (error) { return { ok: false, reason: error instanceof Error ? error.message : String(error) } }
  }, [])
  const replaceSelectedVideo = useCallback(async () => {
    await current.current.runBusy(async () => {
      const owner = current.current, target = captureCourseInsertionTarget(owner.kernel)
      const selected = await owner.selectVideo?.(); if (!selected) return
      const item = namedAsset(await prepare(selected, 'video'))
      await replaceCourseMediaAtTarget(owner.kernel, target, item)
      owner.commitStatus('视频已替换，原播放参数、位置与其他对象保持')
    }, '视频替换失败，原视频保留。')
  }, [])
  return { selectAndImportImage,
    selectAndImportVideo: (mode, position) => batch('video', mode, position), selectAndImportAudio: () => batch('audio', 'library'),
    replaceSelectedVideo, selectAndInsertFlowAudio: () => batch('audio', 'add'), importWorkspaceMedia,
    selectImageAsset: () => pickAsset('image'), selectVideoAsset: () => pickAsset('video'), selectAudioAsset: () => pickAsset('audio'),
    selectMediaAsset: pickAsset,
    selectTargetMedia, batchOperationSummary, clearBatchSummary: () => setBatchOperationSummary(null) }
}
