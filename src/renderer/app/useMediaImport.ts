import { useCallback, useRef, useState } from 'react'
import type { CourseAuthoringTarget } from '../authoring/courseAuthoringSession'
import type { AssetKind, AssetMeta } from '../../shared/contracts/media-v1/types'
import { toUserMessage, UserFacingError } from '../../shared/errors'
import type {
  BatchFileRejection,
  SelectedFileBatch,
  SelectedImageBatchFile,
  SelectedImageResult,
  SelectedMediaBatchFile,
} from '../../shared/ipcTypes'
import {
  createImageAssetImport,
  createMediaAssetImport,
  readImageDimensions,
  readMediaMetadata,
  type ImportedImageAsset,
} from '../project/assetManager'
import {
  commitMediaBatchImport,
  MEDIA_BATCH_CANVAS_LIMIT,
  planMediaBatchImport,
  type MediaBatchLibraryFallback,
} from '../project/mediaBatch'
import {
  dedupeCourseMediaImports,
  prepareHashedMediaBatch,
  type CourseAssetSidecar,
  type CourseImportedAsset,
} from '../project/v9AssetAdapter'

export interface MediaImportIdentity {
  readonly projectId: string
  readonly revision: number
  readonly locationId: string | null
}

export interface MediaLibraryTarget {
  readonly projectId: string
  readonly documentRevision: number
}

export interface MediaLibrarySnapshot {
  readonly assets: Readonly<Record<string, AssetMeta>>
  readonly files: Readonly<Record<string, Uint8Array>>
}

export interface MediaCandidateContext {
  readonly assets: Readonly<Record<string, AssetMeta>>
  readonly sidecar: CourseAssetSidecar
}

export interface MediaImportItem {
  readonly meta: AssetMeta
  readonly bytes: Uint8Array
}

export interface MediaImportIssue {
  readonly name: string
  readonly message: string
}

export interface MediaBatchOutcome {
  readonly label: string
  readonly completedCount: number
  readonly duplicateCount: number
  readonly issues: readonly MediaImportIssue[]
  readonly libraryFallback?: MediaBatchLibraryFallback
}

export interface MediaReplacementCommitResult {
  readonly ok: boolean
  readonly reason?: string
}

export interface MediaLibraryCommitResult {
  readonly ok: boolean
  readonly reason?: string
}

export interface MediaCandidatePlacement {
  readonly items: readonly MediaImportItem[]
  readonly nativeType?: 'image' | 'video' | 'audio'
  readonly mode?: 'add' | 'library'
  readonly x?: number
  readonly y?: number
}

/**
 * Narrow App/desktop ports. Hash/dedupe and canvas placement stay in domain
 * or Store adapters; this module only sequences capture → read → recheck → commit.
 */
export interface MediaImportPorts {
  captureIdentity(): MediaImportIdentity | null
  captureLibraryTarget(): MediaLibraryTarget | null
  captureImageReplacementTarget(): CourseAuthoringTarget | null
  readMediaLibrarySnapshot(): MediaLibrarySnapshot | null
  readCandidateMediaContext(): MediaCandidateContext | null
  replaceImageAtTarget(
    target: CourseAuthoringTarget,
    asset: AssetMeta,
    bytes: Uint8Array,
  ): MediaReplacementCommitResult
  importAssetsAtTarget(
    target: MediaLibraryTarget,
    items: readonly MediaImportItem[],
  ): MediaLibraryCommitResult
  placeImageNodes(
    items: readonly MediaImportItem[],
    position?: { x?: number; y?: number },
  ): string[]
  placeVideoNodes(
    items: readonly MediaImportItem[],
    position?: { x?: number; y?: number },
  ): string[]
  importSounds(items: readonly MediaImportItem[]): void
  commitCandidateMedia(input: MediaCandidatePlacement): void
  selectImage(): Promise<SelectedImageResult | null>
  selectImages(): Promise<SelectedFileBatch<SelectedImageBatchFile> | null>
  selectAudios(): Promise<SelectedFileBatch<SelectedMediaBatchFile> | null>
  selectVideos(): Promise<SelectedFileBatch<SelectedMediaBatchFile> | null>
  runBusy<T>(operation: () => Promise<T>, fallback: string): Promise<T | undefined>
  commitStatus(message: string | null): void
  reportError(message: string): void
}

export interface MediaImportApi {
  selectAndImportImage(
    mode: 'add' | 'library' | 'replace',
    position?: { x?: number; y?: number },
  ): Promise<void>
  selectAndImportVideo(
    mode: 'add' | 'library',
    position?: { x?: number; y?: number },
  ): Promise<void>
  selectAndImportAudio(): Promise<void>
  selectImageAsset(): Promise<ImportedImageAsset | null>
  batchOperationSummary: { title: string; summary: string } | null
  clearBatchSummary(): void
}

function readableError(error: unknown, fallback: string): string {
  if (error instanceof UserFacingError) {
    console.error(error)
    return `${error.title}：${error.message}\n${error.suggestion}`
  }
  if (error instanceof Error && error.message.trim()) {
    console.error(error)
    return error.message
  }
  return toUserMessage(error, fallback)
}

function desktopRejections(issues: BatchFileRejection[]): MediaImportIssue[] {
  return issues.map((issue) => ({
    name: issue.name,
    message: `${issue.message} ${issue.suggestion}`,
  }))
}

function formatBatchIssueSummary(issues: readonly MediaImportIssue[]): string {
  const shown = issues.slice(0, 5).map((issue) => `• ${issue.name}：${issue.message}`)
  if (issues.length > shown.length) {
    shown.push(`• 其他 ${issues.length - shown.length} 个文件未导入`)
  }
  return shown.join('\n')
}

function sameIdentity(
  left: MediaImportIdentity | null,
  right: MediaImportIdentity | null,
): boolean {
  if (!left || !right) return left === right
  return left.projectId === right.projectId
    && left.revision === right.revision
    && left.locationId === right.locationId
}

function assertFreshIdentity(
  started: MediaImportIdentity | null,
  current: MediaImportIdentity | null,
  title: string,
): void {
  if (!started) return
  if (!sameIdentity(started, current)) {
    throw new UserFacingError(
      title,
      '工程已发生变化；请重新选择文件后再试。',
      '请重新选择目标后再试。',
    )
  }
}

function asCommitItems(items: readonly CourseImportedAsset[]): MediaImportItem[] {
  return items.map((item) => ({ meta: item.meta, bytes: item.bytes }))
}

export function useMediaImport(ports: MediaImportPorts): MediaImportApi {
  const portsRef = useRef(ports)
  portsRef.current = ports

  const [batchOperationSummary, setBatchOperationSummary] = useState<{
    title: string
    summary: string
  } | null>(null)

  const reportBatchOutcome = useCallback((input: MediaBatchOutcome) => {
    const details = [
      `已完成 ${input.completedCount} 项`,
      input.duplicateCount > 0 ? `内容重复 ${input.duplicateCount} 项（已复用素材）` : '',
      input.issues.length > 0 ? `失败 ${input.issues.length} 项` : '',
      input.libraryFallback === 'batch-size'
        ? '数量过多，已只加入媒体库'
        : '',
      input.libraryFallback === 'scene-capacity'
        ? '当前层容量不足，已改为只加入媒体库'
        : '',
    ].filter(Boolean)
    portsRef.current.commitStatus(`${input.label}：${details.join('；')}`)
    if (input.issues.length > 0) {
      portsRef.current.reportError(
        `${input.label}部分文件未完成：\n${formatBatchIssueSummary(input.issues)}`,
      )
      setBatchOperationSummary({
        title: `${input.label}结果`,
        summary: [
          ...details,
          '',
          '未完成：',
          ...input.issues.map((issue) => `- ${issue.name}：${issue.message}`),
        ].join('\n'),
      })
    }
  }, [])

  const prepareSelection = useCallback(async <T extends {
    name: string
    mimeType: string
    bytes: Uint8Array
    sha256: string
  }>(
    files: T[],
    kind: AssetKind,
    decode: (file: T) => Promise<CourseImportedAsset>,
    snapshot: MediaLibrarySnapshot | null,
  ) => {
    const assets = snapshot?.assets ?? {}
    const assetFiles = snapshot?.files ?? {}
    return prepareHashedMediaBatch(
      files,
      kind,
      assets,
      assetFiles,
      decode,
      (error) => readableError(error, '文件无法解码。'),
    )
  }, [])

  const tryInjectCandidateMedia = useCallback(async (input: {
    kind: AssetKind
    items: readonly CourseImportedAsset[]
    nativeType?: 'image' | 'video' | 'audio'
    mode?: 'add' | 'library'
    position?: { x?: number; y?: number }
  }): Promise<boolean> => {
    const context = portsRef.current.readCandidateMediaContext()
    if (!context) return false
    const deduped = await dedupeCourseMediaImports(
      input.kind,
      context.assets,
      context.sidecar,
      input.items,
    )
    const items = input.mode === 'add' ? deduped.placements : deduped.additions
    portsRef.current.commitCandidateMedia({
      items: asCommitItems(items),
      nativeType: input.nativeType,
      mode: input.mode,
      ...(typeof input.position?.x === 'number' ? { x: input.position.x } : {}),
      ...(typeof input.position?.y === 'number' ? { y: input.position.y } : {}),
    })
    return true
  }, [])

  const importIntoCapturedLibrary = useCallback((
    target: MediaLibraryTarget,
    items: readonly CourseImportedAsset[],
    title: string,
  ) => {
    const result = portsRef.current.importAssetsAtTarget(target, asCommitItems(items))
    if (!result.ok) {
      throw new UserFacingError(
        title,
        result.reason ?? '工程已发生变化；请重新选择文件后再试。',
        '工程已发生变化；请重新选择文件后再试。',
      )
    }
  }, [])

  const selectAndImportImage = useCallback(
    async (
      mode: 'add' | 'library' | 'replace',
      position?: { x?: number; y?: number },
    ) => {
      await portsRef.current.runBusy(async () => {
        const started = portsRef.current.captureIdentity()
        if (mode === 'replace') {
          const target = portsRef.current.captureImageReplacementTarget()
          if (!target) {
            throw new UserFacingError(
              '无法替换图片',
              '当前没有可替换的 Slide 图片。',
              '请先选择当前幻灯片中的图片，再点击“替换图片”。',
            )
          }
          const file = await portsRef.current.selectImage()
          if (!file) return
          assertFreshIdentity(started, portsRef.current.captureIdentity(), '无法替换图片')
          const dimensions = await readImageDimensions(file.bytes, file.mimeType)
          assertFreshIdentity(started, portsRef.current.captureIdentity(), '无法替换图片')
          const imported = createImageAssetImport(file, { dimensions })
          const result = portsRef.current.replaceImageAtTarget(
            target,
            imported.meta,
            imported.bytes,
          )
          if (!result.ok) {
            throw new UserFacingError(
              '无法替换图片',
              result.reason ?? '请重新选择目标图片，再次点击“替换图片”。',
              '请重新选择目标图片，再次点击“替换图片”。',
            )
          }
          return
        }

        const libraryTarget = portsRef.current.captureLibraryTarget()
        if (!libraryTarget) {
          throw new UserFacingError(
            '无法导入图片',
            '当前没有可写入的 Course Project。',
            '请重新打开或新建课件后再试。',
          )
        }
        const librarySnapshot = portsRef.current.readMediaLibrarySnapshot()
        const batch = await portsRef.current.selectImages()
        if (!batch) return
        assertFreshIdentity(started, portsRef.current.captureIdentity(), '图片批量入库已取消')
        const prepared = await prepareSelection(
          batch.accepted,
          'image',
          async (file) => {
            const dimensions = await readImageDimensions(file.bytes, file.mimeType)
            const imported = createImageAssetImport(file, { dimensions })
            return { meta: imported.meta, bytes: imported.bytes }
          },
          librarySnapshot,
        )
        assertFreshIdentity(started, portsRef.current.captureIdentity(), '图片批量入库已取消')
        const issues = [...desktopRejections(batch.rejected), ...prepared.decodeFailures]
        const importPlan = planMediaBatchImport(
          mode,
          prepared.placements.length,
          MEDIA_BATCH_CANVAS_LIMIT,
        )
        if (importPlan.destination === 'library') {
          importIntoCapturedLibrary(libraryTarget, prepared.additions, '图片批量入库已取消')
          reportBatchOutcome({
            label: mode === 'library' ? '图片批量入库' : '图片批量添加',
            completedCount: prepared.additions.length,
            duplicateCount: prepared.duplicateCount,
            issues,
            ...(importPlan.overflowToLibrary
              ? { libraryFallback: 'batch-size' as const }
              : {}),
          })
          return
        }
        if (await tryInjectCandidateMedia({
          kind: 'image',
          items: mode === 'library' ? prepared.additions : prepared.placements,
          nativeType: 'image',
          mode,
          position,
        })) {
          reportBatchOutcome({
            label: mode === 'library' ? '图片批量入库' : '图片批量添加',
            completedCount: mode === 'library'
              ? prepared.additions.length
              : prepared.placements.length,
            duplicateCount: prepared.duplicateCount,
            issues,
          })
          return
        }
        const commitResult = commitMediaBatchImport({
          plan: importPlan,
          placements: prepared.placements,
          additions: prepared.additions,
          placeOnCanvas: (items) => (
            portsRef.current.placeImageNodes(asCommitItems(items), position)
          ),
          importIntoLibrary: (items) => (
            importIntoCapturedLibrary(libraryTarget, items, '图片批量入库已取消')
          ),
        })
        reportBatchOutcome({
          label: mode === 'library' ? '图片批量入库' : '图片批量添加',
          completedCount: commitResult.completedCount,
          duplicateCount: prepared.duplicateCount,
          issues,
          libraryFallback: commitResult.libraryFallback,
        })
      }, '图片读取失败。请重新选择受支持的图片。')
    },
    [importIntoCapturedLibrary, prepareSelection, reportBatchOutcome, tryInjectCandidateMedia],
  )

  const selectImageAsset = useCallback(async (): Promise<ImportedImageAsset | null> => {
    const imported = await portsRef.current.runBusy(async () => {
      const file = await portsRef.current.selectImage()
      if (!file) return null
      const dimensions = await readImageDimensions(file.bytes, file.mimeType)
      return createImageAssetImport(file, { dimensions })
    }, '图片读取失败。请重新选择受支持的图片。')
    return imported ?? null
  }, [])

  const selectAndImportAudio = useCallback(async () => {
    await portsRef.current.runBusy(async () => {
      const started = portsRef.current.captureIdentity()
      const librarySnapshot = portsRef.current.readMediaLibrarySnapshot()
      const batch = await portsRef.current.selectAudios()
      if (!batch) return
      assertFreshIdentity(started, portsRef.current.captureIdentity(), '声音批量入库已取消')
      const prepared = await prepareSelection(
        batch.accepted,
        'audio',
        async (file) => {
          const metadata = await readMediaMetadata(file.bytes, file.mimeType, 'audio')
          const imported = createMediaAssetImport(file, 'audio', metadata)
          return { meta: imported.meta, bytes: imported.bytes }
        },
        librarySnapshot,
      )
      assertFreshIdentity(started, portsRef.current.captureIdentity(), '声音批量入库已取消')
      if (await tryInjectCandidateMedia({
        kind: 'audio',
        items: prepared.additions,
        nativeType: 'audio',
        mode: 'library',
      })) {
        reportBatchOutcome({
          label: '声音批量入库',
          completedCount: prepared.additions.length,
          duplicateCount: prepared.duplicateCount,
          issues: [...desktopRejections(batch.rejected), ...prepared.decodeFailures],
        })
        return
      }
      portsRef.current.importSounds(asCommitItems(prepared.additions))
      reportBatchOutcome({
        label: '声音批量入库',
        completedCount: prepared.additions.length,
        duplicateCount: prepared.duplicateCount,
        issues: [...desktopRejections(batch.rejected), ...prepared.decodeFailures],
      })
    }, '声音读取失败。请重新选择受支持的声音文件。')
  }, [prepareSelection, reportBatchOutcome, tryInjectCandidateMedia])

  const selectAndImportVideo = useCallback(async (
    mode: 'add' | 'library',
    position?: { x?: number; y?: number },
  ) => {
    await portsRef.current.runBusy(async () => {
      const started = portsRef.current.captureIdentity()
      const libraryTarget = portsRef.current.captureLibraryTarget()
      if (!libraryTarget) {
        throw new UserFacingError(
          '无法导入视频',
          '当前没有可写入的 Course Project。',
          '请重新打开或新建课件后再试。',
        )
      }
      const librarySnapshot = portsRef.current.readMediaLibrarySnapshot()
      const batch = await portsRef.current.selectVideos()
      if (!batch) return
      assertFreshIdentity(started, portsRef.current.captureIdentity(), '视频批量入库已取消')
      const prepared = await prepareSelection(
        batch.accepted,
        'video',
        async (file) => {
          const metadata = await readMediaMetadata(file.bytes, file.mimeType, 'video')
          const imported = createMediaAssetImport(file, 'video', metadata)
          return { meta: imported.meta, bytes: imported.bytes }
        },
        librarySnapshot,
      )
      assertFreshIdentity(started, portsRef.current.captureIdentity(), '视频批量入库已取消')
      const issues = [...desktopRejections(batch.rejected), ...prepared.decodeFailures]
      const importPlan = planMediaBatchImport(
        mode,
        prepared.placements.length,
        MEDIA_BATCH_CANVAS_LIMIT,
      )
      if (importPlan.destination === 'library') {
        importIntoCapturedLibrary(libraryTarget, prepared.additions, '视频批量入库已取消')
        reportBatchOutcome({
          label: mode === 'add' ? '视频批量添加' : '视频批量入库',
          completedCount: prepared.additions.length,
          duplicateCount: prepared.duplicateCount,
          issues,
          ...(importPlan.overflowToLibrary
            ? { libraryFallback: 'batch-size' as const }
            : {}),
        })
        return
      }
      if (await tryInjectCandidateMedia({
        kind: 'video',
        items: mode === 'library' ? prepared.additions : prepared.placements,
        nativeType: 'video',
        mode,
        position,
      })) {
        reportBatchOutcome({
          label: mode === 'add' ? '视频批量添加' : '视频批量入库',
          completedCount: mode === 'add'
            ? prepared.placements.length
            : prepared.additions.length,
          duplicateCount: prepared.duplicateCount,
          issues,
        })
        return
      }
      const commitResult = commitMediaBatchImport({
        plan: importPlan,
        placements: prepared.placements,
        additions: prepared.additions,
        placeOnCanvas: (items) => (
          portsRef.current.placeVideoNodes(asCommitItems(items), position)
        ),
        importIntoLibrary: (items) => (
          importIntoCapturedLibrary(libraryTarget, items, '视频批量入库已取消')
        ),
      })
      reportBatchOutcome({
        label: mode === 'add' ? '视频批量添加' : '视频批量入库',
        completedCount: commitResult.completedCount,
        duplicateCount: prepared.duplicateCount,
        issues,
        libraryFallback: commitResult.libraryFallback,
      })
    }, '视频读取失败。请重新选择 MP4 或 WebM 文件。')
  }, [importIntoCapturedLibrary, prepareSelection, reportBatchOutcome, tryInjectCandidateMedia])

  const clearBatchSummary = useCallback(() => {
    setBatchOperationSummary(null)
  }, [])

  return {
    selectAndImportImage,
    selectAndImportVideo,
    selectAndImportAudio,
    selectImageAsset,
    batchOperationSummary,
    clearBatchSummary,
  }
}
