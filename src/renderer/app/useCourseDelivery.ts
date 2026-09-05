import { useCallback, useEffect, useRef, useState } from 'react'
import type { ComponentPackageData } from '../../shared/componentTypes'
import type { CourseProjectDocument } from '../../shared/courseProjectTypes'
import { toUserMessage, UserFacingError } from '../../shared/errors'
import { prepareBundledFontEmbedding } from '../export/bundledFontEmbedding'
import {
  buildPublishedCourseStandaloneHtml,
  buildPublishedCourseWebPackageAsync,
} from '../export/course/buildCoursePackages'
import type { SingleHtmlExportMode } from '../export/course/coursePackagePreflight'
import { buildCoursePptx } from '../export/course/buildCoursePptx'
import { buildCoursePrintArtifacts } from '../export/course/buildCoursePrintArtifacts'
import {
  buildPublishedCourseV2Payload,
  type CoursePublishSources,
} from '../export/course/buildPublishedCourse'
import { buildFlowDocx, uniqueFlowDocxFilename } from '../export/course/flowDocx'
import {
  collectCourseProjectExportPreflight,
  type CourseProjectExportPreflightReportV1,
  type ExportPreflightItem,
  type ExportPreflightTarget,
} from '../export/exportPreflight'
import {
  SINGLE_HTML_HARD_LIMIT_BYTES,
  SINGLE_HTML_WARNING_BYTES,
  utf8ByteLength,
} from '../export/exportSize'
import { loadPlayerBundle } from '../export/loadPlayerBundle'
import type { PublishedCourseSession } from '../../player/surfaces/publishedDynamicHosts'
import { attachPublishedCourseStageFit, mountPublishedCourseTryRun } from '../ui/coursePlayerTryRun'
import { beginSerializedSessionMount, enqueueSerial } from '../ui/serializedSessionMount'

export type CourseDeliveryFormat =
  | 'single-html'
  | 'web-package'
  | 'pptx'
  | 'pdf'
  | 'docx'

export interface CourseDeliverySnapshot {
  readonly project: CourseProjectDocument
  readonly assetFiles: Readonly<Record<string, Uint8Array>>
  readonly components: Readonly<Record<string, ComponentPackageData>>
}

export interface CourseDeliveryIdentity {
  readonly projectId: string
  readonly revision: number
}

export interface CourseDeliveryPreviewFeedback {
  readonly kind: 'loading' | 'error'
  readonly title: string
  readonly message: string
}

/**
 * Narrow App/desktop ports. Format producers are imported by this module;
 * do not pass the root Store or the full Preload API.
 */
export interface CourseDeliveryPorts {
  readCanonicalSnapshot(): CourseDeliverySnapshot | null
  runBusy<T>(operation: () => Promise<T>, fallback: string): Promise<T | undefined>
  commitStatus(message: string | null): void
  reportError(message: string): void
  navigateFinding(item: ExportPreflightItem): void
  exportHtml(input: {
    suggestedName: string
    html: string
  }): Promise<{ path: string } | null>
  exportWebPackage(input: {
    suggestedName: string
    bytes: Uint8Array
  }): Promise<{ path: string } | null>
  exportPdf(input: {
    suggestedName: string
    html: string
  }): Promise<{ path: string } | null>
  exportBinary(input: {
    suggestedName: string
    extension: 'pptx' | 'json' | 'docx'
    bytes: Uint8Array
  }): Promise<{ path: string } | null>
}

export interface CourseDeliveryWatch {
  readonly documentTrigger: unknown
  readonly sidecarTrigger: unknown
  readonly componentPackagesTrigger: unknown
}

export interface CourseDeliveryApi {
  readonly previewOpen: boolean
  readonly previewFeedback: CourseDeliveryPreviewFeedback | null
  readonly exportPreflightReport: CourseProjectExportPreflightReportV1 | null
  readonly largeHtmlByteLength: number | null
  readonly singleHtmlHardLimitBytes: number
  bindPreviewHost(host: HTMLDivElement | null): void
  previousPreview(): void
  nextPreview(): void
  closePreview(): void
  openPreview(): void
  exportCourse(format: CourseDeliveryFormat, singleHtmlMode?: SingleHtmlExportMode): void
  cancelPreflight(): void
  continuePreflightExport(): void
  locatePreflightItem(item: ExportPreflightItem): void
  savePreflightReport(): void
  cancelLargeHtml(): void
  continueLargeHtml(): void
  exportLargeHtmlAsWebPackage(): void
}

type CourseDeliveryTarget = 'full-preview' | ExportPreflightTarget

interface PendingExport {
  readonly snapshot: CourseDeliverySnapshot
  readonly identity: CourseDeliveryIdentity
  readonly format: ExportPreflightTarget
  readonly singleHtmlMode: SingleHtmlExportMode | null
}

interface PendingLargeHtml {
  readonly html: string
  readonly mode: SingleHtmlExportMode
  readonly title: string
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

function courseDeliveryUnavailable(target: CourseDeliveryTarget): UserFacingError {
  const title = target === 'full-preview'
    ? '整课预览不可用'
    : target === 'single-html'
      ? '单 HTML 导出不可用'
      : target === 'web-package'
        ? '网页包导出不可用'
        : target === 'pptx'
          ? 'PPTX 导出不可用'
          : 'PDF 导出不可用'
  return new UserFacingError(
    title,
    '当前编辑会话没有可发布的 Course Project V9 文档。',
    '请新建或重新打开受支持的课程工程后再试。',
  )
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes)
}

function publishSources(snapshot: CourseDeliverySnapshot): CoursePublishSources {
  return {
    project: snapshot.project,
    assetFiles: snapshot.assetFiles,
    components: snapshot.components,
  }
}

function snapshotIdentity(snapshot: CourseDeliverySnapshot): CourseDeliveryIdentity {
  return {
    projectId: snapshot.project.id,
    revision: snapshot.project.revision,
  }
}

function sameDeliveryIdentity(
  left: CourseDeliveryIdentity,
  right: CourseDeliveryIdentity,
): boolean {
  return left.projectId === right.projectId && left.revision === right.revision
}

function collectDeliveryPreflight(
  snapshot: CourseDeliverySnapshot,
  format: ExportPreflightTarget,
  singleHtmlMode: SingleHtmlExportMode | null,
): CourseProjectExportPreflightReportV1 {
  return collectCourseProjectExportPreflight(
    snapshot.project,
    format,
    {
      assetFiles: snapshot.assetFiles,
      components: snapshot.components,
    },
    new Date(),
    {
      playerBundle: loadPlayerBundle(),
      ...(singleHtmlMode ? { singleHtmlMode } : {}),
    },
  )
}

export function useCourseDelivery(
  ports: CourseDeliveryPorts,
  watch: CourseDeliveryWatch,
): CourseDeliveryApi {
  const portsRef = useRef(ports)
  portsRef.current = ports

  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewHost, setPreviewHost] = useState<HTMLDivElement | null>(null)
  const previewSessionRef = useRef<PublishedCourseSession | null>(null)
  const previewFitRef = useRef<(() => void) | null>(null)
  const previewMountChainRef = useRef(Promise.resolve())
  const [previewFeedback, setPreviewFeedback] = useState<CourseDeliveryPreviewFeedback | null>(null)
  const [exportPreflightReport, setExportPreflightReport] =
    useState<CourseProjectExportPreflightReportV1 | null>(null)
  const [largeHtmlByteLength, setLargeHtmlByteLength] = useState<number | null>(null)
  const pendingExportRef = useRef<PendingExport | null>(null)
  const pendingLargeHtmlRef = useRef<PendingLargeHtml | null>(null)

  const writeSingleHtml = useCallback(async (
    html: string,
    mode: SingleHtmlExportMode,
    title: string,
  ) => {
    const result = await portsRef.current.exportHtml({
      suggestedName: `${title}.html`,
      html,
    })
    if (result) {
      const label = mode === 'online-lightweight' ? '在线轻量单 HTML' : '离线便携单 HTML'
      portsRef.current.commitStatus(`${label}已导出到 ${result.path}`)
    }
  }, [])

  const emitHtml = useCallback((
    snapshot: CourseDeliverySnapshot,
    mode: SingleHtmlExportMode,
  ) => {
    void portsRef.current.runBusy(async () => {
      // The builders are synchronous, so the bundled font bytes have to be in
      // hand before the build starts; this is the only await that can put them
      // there. Free after the first export of a session, and free in any host
      // whose byte source is already synchronous.
      await prepareBundledFontEmbedding()
      const html = buildPublishedCourseStandaloneHtml(publishSources(snapshot), {
        playerBundle: loadPlayerBundle(),
        singleHtmlMode: mode,
      })
      const byteLength = utf8ByteLength(html)
      if (byteLength > SINGLE_HTML_WARNING_BYTES) {
        pendingLargeHtmlRef.current = { html, mode, title: snapshot.project.title }
        setLargeHtmlByteLength(byteLength)
        return
      }
      await writeSingleHtml(html, mode, snapshot.project.title)
    }, '导出失败。请检查磁盘空间并重试。')
  }, [writeSingleHtml])

  const emitWebPackage = useCallback((snapshot: CourseDeliverySnapshot) => {
    void portsRef.current.runBusy(async () => {
      portsRef.current.commitStatus('正在生成网页包…')
      await prepareBundledFontEmbedding()
      const bytes = await buildPublishedCourseWebPackageAsync(
        publishSources(snapshot),
        loadPlayerBundle(),
      )
      const result = await portsRef.current.exportWebPackage({
        suggestedName: `${snapshot.project.title}-网页包.zip`,
        bytes,
      })
      if (result) portsRef.current.commitStatus(`网页包已导出到 ${result.path}`)
    }, '网页包导出失败。请检查磁盘空间并重试。')
  }, [])

  const emitPptx = useCallback((snapshot: CourseDeliverySnapshot) => {
    void portsRef.current.runBusy(async () => {
      portsRef.current.commitStatus('正在生成可编辑 PPTX 对象…')
      const built = await buildCoursePptx(publishSources(snapshot))
      const producerErrors = built.report.filter((item) => item.severity === 'error')
      if (producerErrors.length > 0 || built.bytes.byteLength === 0) {
        const details = producerErrors
          .slice(0, 4)
          .map((item) => item.message)
          .join('\n') || '未能生成 PPTX'
        const remaining = producerErrors.length > 4
          ? `\n另有 ${producerErrors.length - 4} 项阻断。`
          : ''
        throw new UserFacingError(
          'PPTX 导出失败',
          `${details}${remaining}`,
          '请按提示修复内容或资源后重试；本次没有写出不完整 PPTX。',
        )
      }
      const result = await portsRef.current.exportBinary({
        suggestedName: `${snapshot.project.title}.pptx`,
        extension: 'pptx',
        bytes: built.bytes,
      })
      if (result) {
        const notes = built.warnings.length > 0
          ? `；${built.warnings.length} 项内容已按导出说明处理`
          : ''
        portsRef.current.commitStatus(
          `PPTX 已导出 ${built.slideCount} 页到 ${result.path}${notes}`,
        )
      }
    }, 'PPTX 导出失败。请减少大图片数量后重试。')
  }, [])

  const emitPdf = useCallback((snapshot: CourseDeliverySnapshot) => {
    void portsRef.current.runBusy(async () => {
      portsRef.current.commitStatus('正在渲染 PDF 页面…')
      const artifacts = await buildCoursePrintArtifacts(publishSources(snapshot))
      const producerErrors = artifacts.report.filter((item) => item.severity === 'error')
      if (producerErrors.length > 0) {
        const details = producerErrors
          .slice(0, 4)
          .map((item) => item.message)
          .join('\n')
        const remaining = producerErrors.length > 4
          ? `\n另有 ${producerErrors.length - 4} 项阻断。`
          : ''
        throw new UserFacingError(
          'PDF 导出失败',
          `${details}${remaining}`,
          '请按提示修复内容或资源后重试；本次没有写出不完整 PDF。',
        )
      }
      const pdfFile = artifacts.files.find((file) => file.kind === 'pdf-html')
      if (pdfFile) {
        const result = await portsRef.current.exportPdf({
          suggestedName: `${snapshot.project.title}.pdf`,
          html: decodeUtf8(pdfFile.bytes),
        })
        if (result) {
          const notes = artifacts.warnings.length > 0
            ? `；${artifacts.warnings.length} 项内容已按导出说明处理`
            : ''
          portsRef.current.commitStatus(`PDF 已导出到 ${result.path}${notes}`)
        }
        return
      }
      throw new UserFacingError(
        'PDF 导出不完整',
        'Published Course V2 未生成覆盖当前课程全部表面的 PDF 打印内容。',
        '请检查导出预检与混合打印计划后重试；本次不会回退到旧版 V8 Slide 快照。',
      )
    }, 'PDF 导出失败。请减少大图片数量后重试。')
  }, [])

  const emitDocx = useCallback(() => {
    void portsRef.current.runBusy(async () => {
      const snapshot = portsRef.current.readCanonicalSnapshot()
      if (!snapshot) {
        throw new Error('DOCX 讲义仅适用于当前课程工程中的流式讲义')
      }
      const published = buildPublishedCourseV2Payload(publishSources(snapshot))
      const flowSurfaces = published.surfaces.filter((surface) => surface.type === 'flow')
      if (flowSurfaces.length === 0) {
        throw new Error('当前课程没有流式讲义，无法导出 DOCX')
      }
      const usedNames = new Set<string>()
      const exportedPaths: string[] = []
      let warningCount = 0
      for (const flowSurface of flowSurfaces) {
        const built = buildFlowDocx(published, flowSurface.id, {
          resolveAsset: (assetId) => {
            const meta = snapshot.project.assets[assetId]
            const bytes = snapshot.assetFiles[assetId]
            return meta && bytes
              ? { bytes, mimeType: meta.mimeType, filename: meta.filename }
              : undefined
          },
        })
        warningCount += built.warnings.length
        const suggestedName = uniqueFlowDocxFilename(flowSurface.title, usedNames)
        usedNames.add(suggestedName)
        const result = await portsRef.current.exportBinary({
          suggestedName,
          extension: 'docx',
          bytes: built.bytes,
        })
        if (result) exportedPaths.push(result.path)
      }
      if (exportedPaths.length > 0) {
        const notes = warningCount > 0
          ? `；${warningCount} 项内容已按导出说明处理`
          : ''
        const destination = exportedPaths.length === 1
          ? exportedPaths[0]
          : `${exportedPaths.length} 个文件`
        portsRef.current.commitStatus(
          `DOCX 讲义已导出 ${exportedPaths.length}/${flowSurfaces.length} 份到 ${destination}${notes}`,
        )
      }
    }, 'DOCX 导出失败。请先新增流式讲义页面后重试。')
  }, [])

  const clearPreflight = useCallback(() => {
    pendingExportRef.current = null
    setExportPreflightReport(null)
  }, [])

  const cancelLargeHtml = useCallback(() => {
    pendingLargeHtmlRef.current = null
    setLargeHtmlByteLength(null)
  }, [])

  const openPreview = useCallback(() => {
    void portsRef.current.runBusy(async () => {
      if (!portsRef.current.readCanonicalSnapshot()) {
        throw courseDeliveryUnavailable('full-preview')
      }
      setPreviewFeedback({
        kind: 'loading',
        title: '正在准备整课预览',
        message: '正在载入 CoursePlayer…',
      })
      setPreviewOpen(true)
    }, '整课预览不可用。请重新打开课程工程后重试。')
  }, [])

  const closePreview = useCallback(() => {
    setPreviewOpen(false)
  }, [])

  const previousPreview = useCallback(() => {
    void previewSessionRef.current?.previous()
  }, [])

  const nextPreview = useCallback(() => {
    void previewSessionRef.current?.next()
  }, [])

  const exportCourse = useCallback((
    format: CourseDeliveryFormat,
    singleHtmlMode: SingleHtmlExportMode = 'offline-portable',
  ) => {
    if (format === 'docx') {
      emitDocx()
      return
    }
    const requestedSingleHtmlMode = format === 'single-html' ? singleHtmlMode : null
    const snapshot = portsRef.current.readCanonicalSnapshot()
    if (!snapshot) {
      pendingExportRef.current = null
      void portsRef.current.runBusy(async () => {
        throw courseDeliveryUnavailable(format)
      }, '课程交付不可用。请重新打开课程工程后重试。')
      return
    }
    pendingExportRef.current = {
      snapshot,
      identity: snapshotIdentity(snapshot),
      format,
      singleHtmlMode: requestedSingleHtmlMode,
    }
    setExportPreflightReport(collectDeliveryPreflight(
      snapshot,
      format,
      requestedSingleHtmlMode,
    ))
  }, [emitDocx])

  const continuePreflightExport = useCallback(() => {
    const report = exportPreflightReport
    const pending = pendingExportRef.current
    if (!report?.summary.canExport || !pending) return
    const current = portsRef.current.readCanonicalSnapshot()
    if (!current) {
      // The preflighted snapshot is only emitted for the session that passed
      // preflight; a session without a publishable document fails loud.
      clearPreflight()
      void portsRef.current.runBusy(async () => {
        throw courseDeliveryUnavailable(pending.format)
      }, '课程交付不可用。请重新打开课程工程后重试。')
      return
    }
    if (!sameDeliveryIdentity(snapshotIdentity(current), pending.identity)) {
      pendingExportRef.current = {
        snapshot: current,
        identity: snapshotIdentity(current),
        format: pending.format,
        singleHtmlMode: pending.singleHtmlMode,
      }
      setExportPreflightReport(collectDeliveryPreflight(
        current,
        pending.format,
        pending.singleHtmlMode,
      ))
      return
    }
    const singleHtmlMode = pending.singleHtmlMode ?? 'offline-portable'
    clearPreflight()
    if (report.target === 'single-html') emitHtml(pending.snapshot, singleHtmlMode)
    else if (report.target === 'web-package') emitWebPackage(pending.snapshot)
    else if (report.target === 'pptx') emitPptx(pending.snapshot)
    else emitPdf(pending.snapshot)
  }, [
    clearPreflight,
    emitHtml,
    emitPdf,
    emitPptx,
    emitWebPackage,
    exportPreflightReport,
  ])

  const locatePreflightItem = useCallback((item: ExportPreflightItem) => {
    const current = portsRef.current.readCanonicalSnapshot()
    const pending = pendingExportRef.current
    if (
      !current
      || !pending
      || !sameDeliveryIdentity(snapshotIdentity(current), pending.identity)
    ) {
      portsRef.current.reportError('导出预检结果已过期：工程已修改，请重新执行导出预检。')
      clearPreflight()
      return
    }
    portsRef.current.navigateFinding(item)
    portsRef.current.commitStatus(`已定位导出预检问题：${item.message}`)
    clearPreflight()
  }, [clearPreflight])

  const savePreflightReport = useCallback(() => {
    const report = exportPreflightReport
    if (!report) return
    const title = pendingExportRef.current?.snapshot.project.title
    void portsRef.current.runBusy(async () => {
      const bytes = new TextEncoder().encode(`${JSON.stringify(report, null, 2)}\n`)
      const result = await portsRef.current.exportBinary({
        suggestedName: `${title ?? report.projectId}-${report.target}-preflight.json`,
        extension: 'json',
        bytes,
      })
      if (result) portsRef.current.commitStatus(`导出预检报告已保存到 ${result.path}`)
    }, '导出预检报告保存失败。请换一个可写目录后重试。')
  }, [exportPreflightReport])

  const continueLargeHtml = useCallback(() => {
    const pending = pendingLargeHtmlRef.current
    cancelLargeHtml()
    if (!pending) return
    void portsRef.current.runBusy(
      () => writeSingleHtml(pending.html, pending.mode, pending.title),
      '单 HTML 导出失败。请改用网页包或检查磁盘空间。',
    )
  }, [cancelLargeHtml, writeSingleHtml])

  const exportLargeHtmlAsWebPackage = useCallback(() => {
    cancelLargeHtml()
    exportCourse('web-package')
  }, [cancelLargeHtml, exportCourse])

  useEffect(() => {
    if (!previewOpen || !previewHost) {
      const leftover = previewSessionRef.current
      previewSessionRef.current = null
      if (leftover) enqueueSerial(previewMountChainRef, () => leftover.destroy())
      return
    }
    const snapshot = portsRef.current.readCanonicalSnapshot()
    if (!snapshot) {
      setPreviewOpen(false)
      return
    }
    setPreviewFeedback({
      kind: 'loading',
      title: '正在准备整课预览',
      message: '正在载入 CoursePlayer…',
    })
    return beginSerializedSessionMount(previewMountChainRef, () => mountPublishedCourseTryRun({
      container: previewHost,
      project: snapshot.project,
      assetFiles: snapshot.assetFiles,
      components: snapshot.components,
    }), {
      onReady: (session) => {
        previewFitRef.current?.()
        previewFitRef.current = attachPublishedCourseStageFit(previewHost)
        previewSessionRef.current = session
        setPreviewFeedback(null)
      },
      onError: (error) => {
        setPreviewFeedback({
          kind: 'error',
          title: '整课预览启动失败',
          message: readableError(error, '播放器未能完成启动。请关闭后重试。'),
        })
      },
      onCleanup: () => {
        previewFitRef.current?.()
        previewFitRef.current = null
        previewSessionRef.current = null
      },
    })
  }, [
    previewHost,
    previewOpen,
    watch.componentPackagesTrigger,
    watch.documentTrigger,
    watch.sidecarTrigger,
  ])

  return {
    previewOpen,
    previewFeedback,
    exportPreflightReport,
    largeHtmlByteLength,
    singleHtmlHardLimitBytes: SINGLE_HTML_HARD_LIMIT_BYTES,
    bindPreviewHost: setPreviewHost,
    previousPreview,
    nextPreview,
    closePreview,
    openPreview,
    exportCourse,
    cancelPreflight: clearPreflight,
    continuePreflightExport,
    locatePreflightItem,
    savePreflightReport,
    cancelLargeHtml,
    continueLargeHtml,
    exportLargeHtmlAsWebPackage,
  }
}
