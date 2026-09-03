import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  AvailableComponentCatalogPackage,
  ComponentCatalogSnapshot,
} from '../../shared/componentCatalog'
import type { ComponentPackageData } from '../../shared/componentTypes'
import { toUserMessage, UserFacingError } from '../../shared/errors'
import type {
  OpenBinaryFileResult,
  SelectedBinaryBatchFile,
  SelectedFileBatch,
} from '../../shared/ipcTypes'
import { componentCatalogInstallStatus } from '../components/componentCatalogStatus'
import { planCatalogBatchJoin } from '../components/componentLibraryModel'
import {
  componentPackageSha256,
  importComponentPackageAsync,
} from '../components/importComponentPackage'

export interface ComponentLibraryIdentity {
  readonly projectId: string
  readonly revision: number
}

export interface ComponentPackageTarget {
  readonly projectId: string
  readonly documentRevision: number
  readonly packageId: string
}

export interface ComponentPackageReplacementCommitResult {
  readonly ok: boolean
  readonly reason?: string
}

export interface ComponentCatalogPackageBytes {
  readonly bytes: Uint8Array
  readonly sha256: string
}

export interface ComponentPackageReplacementRequest {
  readonly mode: 'replace'
  readonly packageId: string
  readonly target: ComponentPackageTarget
  readonly packageData: ComponentPackageData
  readonly sourceFileName: string
}

export interface CatalogPackageUpdateRequest {
  readonly mode: 'update'
  readonly entries: AvailableComponentCatalogPackage[]
}

/**
 * Narrow App/desktop ports. Catalog/Package identity stays in domain modules;
 * this hook only sequences capture → validate → recheck → commit.
 */
export interface ComponentLibraryPorts {
  captureIdentity(): ComponentLibraryIdentity | null
  captureReplacementTarget(packageId: string): ComponentPackageTarget | null
  readInstalledPackages(): Readonly<Record<string, ComponentPackageData>>
  replacePackageAtTarget(
    target: ComponentPackageTarget,
    packageData: ComponentPackageData,
  ): ComponentPackageReplacementCommitResult
  importPackages(packages: readonly ComponentPackageData[]): void
  selectComponentPackage(): Promise<OpenBinaryFileResult | null>
  selectComponentPackages(): Promise<SelectedFileBatch<SelectedBinaryBatchFile> | null>
  desktopAvailable(): boolean
  loadCatalog(): Promise<ComponentCatalogSnapshot>
  readCatalogPackage(input: {
    sourceId: string
    packageId: string
    version: string
  }): Promise<ComponentCatalogPackageBytes>
  runBusy<T>(operation: () => Promise<T>, fallback: string): Promise<T | undefined>
  commitStatus(message: string | null): void
  reportError(message: string): void
}

export interface ComponentLibraryApi {
  componentCatalog: ComponentCatalogSnapshot
  replacementRequest: ComponentPackageReplacementRequest | null
  catalogUpdateRequest: CatalogPackageUpdateRequest | null
  importExternalPackages(): void
  replacePackage(packageId: string): void
  refreshCatalog(): void
  addCatalogPackages(entries: AvailableComponentCatalogPackage[]): Promise<boolean>
  requestCatalogUpdate(entry: AvailableComponentCatalogPackage): void
  confirmReplacement(): void
  cancelReplacement(): void
  confirmCatalogUpdate(): void
  cancelCatalogUpdate(): void
}

const EMPTY_COMPONENT_CATALOG: ComponentCatalogSnapshot = {
  sources: [],
  packages: [],
  issues: [],
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

function sameIdentity(
  left: ComponentLibraryIdentity | null,
  right: ComponentLibraryIdentity | null,
): boolean {
  if (!left || !right) return left === right
  return left.projectId === right.projectId && left.revision === right.revision
}

function assertFreshIdentity(
  started: ComponentLibraryIdentity | null,
  current: ComponentLibraryIdentity | null,
  title: string,
  suggestion: string,
): void {
  if (!started) return
  if (!sameIdentity(started, current)) {
    throw new UserFacingError(
      title,
      '工程或组件状态已发生变化，请重新开始。',
      suggestion,
    )
  }
}

function assertSameProject(
  started: ComponentLibraryIdentity | null,
  current: ComponentLibraryIdentity | null,
  title: string,
  suggestion: string,
): void {
  if (!started) return
  if (!current || started.projectId !== current.projectId) {
    throw new UserFacingError(
      title,
      '工程或组件状态已发生变化，请重新开始。',
      suggestion,
    )
  }
}

export function useComponentLibrary(ports: ComponentLibraryPorts): ComponentLibraryApi {
  const portsRef = useRef(ports)
  portsRef.current = ports

  const [componentCatalog, setComponentCatalog] = useState<ComponentCatalogSnapshot>(
    EMPTY_COMPONENT_CATALOG,
  )
  const [replacementRequest, setReplacementRequest] = useState<
    ComponentPackageReplacementRequest | null
  >(null)
  const [catalogUpdateRequest, setCatalogUpdateRequest] = useState<
    CatalogPackageUpdateRequest | null
  >(null)

  const importExternalPackages = useCallback(() => {
    void portsRef.current.runBusy(async () => {
      const started = portsRef.current.captureIdentity()
      const batch = await portsRef.current.selectComponentPackages()
      if (!batch) return
      const issues = batch.rejected.map((item) =>
        `${item.name}：${item.title}；${item.message}；${item.suggestion}`,
      )
      const packagesById = new Map<string, ComponentPackageData>()
      const currentPackages = { ...portsRef.current.readInstalledPackages() }
      for (const file of batch.accepted) {
        try {
          const imported = await importComponentPackageAsync(file.bytes, {
            provenance: {
              sha256: file.sha256,
              importedAt: new Date().toISOString(),
              sourceLabel: `手动导入：${file.name}`,
            },
          })
          const packageId = imported.manifest.id
          const duplicateInBatch = packagesById.get(packageId)
          if (duplicateInBatch) {
            issues.push(
              `${file.name}：同一批次已包含组件 ${packageId} ` +
              `v${duplicateInBatch.manifest.version}，请每个 ID 只选择一个版本。`,
            )
            continue
          }
          const existing = currentPackages[packageId]
          if (existing) {
            const sameLockedPackage =
              existing.manifest.version === imported.manifest.version &&
              existing.provenance?.sha256 === imported.provenance?.sha256
            issues.push(sameLockedPackage
              ? `${file.name}：工程已经包含完全相同的组件，已跳过。`
              : `${file.name}：工程已包含 ${packageId} v${existing.manifest.version}；请从工程组件菜单审阅更新或替换。`)
            continue
          }
          packagesById.set(packageId, imported)
        } catch (error) {
          issues.push(`${file.name}：${readableError(error, '组件包内容无效。')}`)
        }
      }

      const packages = [...packagesById.values()]
      assertFreshIdentity(
        started,
        portsRef.current.captureIdentity(),
        '外部组件导入已取消',
        '请重新选择 .h5component 文件后再试。',
      )
      const latestPackages = portsRef.current.readInstalledPackages()
      for (const next of packages) {
        if (latestPackages[next.manifest.id]) {
          throw new UserFacingError(
            '外部组件导入已取消',
            '工程内组件状态在读取期间发生变化。',
            '请重新选择 .h5component 文件后再试。',
          )
        }
      }
      if (packages.length === 0) {
        portsRef.current.commitStatus('外部组件导入未改变工程')
        if (issues.length > 0) {
          portsRef.current.reportError(`没有可加入工程的组件：\n${issues.slice(0, 8).join('\n')}`)
        }
        return
      }
      portsRef.current.importPackages(packages)
      portsRef.current.commitStatus(
        issues.length > 0
          ? `已加入 ${packages.length} 个外部组件，${issues.length} 项未加入`
          : `已加入 ${packages.length} 个外部组件`,
      )
      if (issues.length > 0) {
        portsRef.current.reportError(
          `已加入 ${packages.length} 个组件；另有 ${issues.length} 项未加入：\n` +
          issues.slice(0, 8).join('\n'),
        )
      }
    }, '外部组件读取失败。请重新选择 .h5component 文件。')
  }, [])

  const replacePackage = useCallback((packageId: string) => {
    void portsRef.current.runBusy(async () => {
      const started = portsRef.current.captureIdentity()
      const target = portsRef.current.captureReplacementTarget(packageId)
      if (!target) {
        throw new UserFacingError(
          '组件替换已取消',
          `工程中不存在可替换的组件包“${packageId}”。`,
          '请刷新工程组件列表后重试。',
        )
      }
      const file = await portsRef.current.selectComponentPackage()
      if (!file) return
      assertSameProject(
        started,
        portsRef.current.captureIdentity(),
        '组件替换已取消',
        '请刷新工程组件列表后重试。',
      )
      const sha256 = await componentPackageSha256(file.bytes)
      const imported = await importComponentPackageAsync(file.bytes, {
        provenance: {
          sha256,
          importedAt: new Date().toISOString(),
          sourceLabel: `手动替换：${file.name}`,
        },
      })
      if (imported.manifest.id !== packageId) {
        throw new UserFacingError(
          '组件替换已取消',
          `所选包 ID 为“${imported.manifest.id}”，与工程组件“${packageId}”不一致。`,
          '请选择同一组件 ID 的新版本；需要并存的组件应作为新包导入。',
        )
      }
      setReplacementRequest({
        mode: 'replace',
        packageId,
        target,
        packageData: imported,
        sourceFileName: file.name,
      })
    }, '组件替换包读取失败，工程内原版本已保留。')
  }, [])

  const confirmReplacement = useCallback(() => {
    const request = replacementRequest
    setReplacementRequest(null)
    if (!request) return
    void portsRef.current.runBusy(async () => {
      const result = portsRef.current.replacePackageAtTarget(request.target, request.packageData)
      if (!result.ok) {
        throw new UserFacingError(
          '组件替换失败',
          result.reason ?? '工程或组件状态已发生变化，请重新开始替换。',
          '工程或组件状态已发生变化，请重新开始替换。',
        )
      }
    }, '组件替换失败，工程内原版本已保留。')
  }, [replacementRequest])

  const cancelReplacement = useCallback(() => {
    setReplacementRequest(null)
  }, [])

  const performCatalogPackageOperation = useCallback(async (
    entries: AvailableComponentCatalogPackage[],
    mode: 'add' | 'update',
  ): Promise<boolean> => {
    const completed = await portsRef.current.runBusy(async () => {
      const started = portsRef.current.captureIdentity()
      const installedBefore = portsRef.current.readInstalledPackages()
      const pendingEntries = mode === 'add'
        ? entries.filter((entry) =>
            componentCatalogInstallStatus(
              entry,
              installedBefore[entry.packageId],
            ) === 'available',
          )
        : entries
      if (mode === 'add' && pendingEntries.length === 0) {
        portsRef.current.commitStatus('所选组件均已加入工程')
        return true
      }
      const updateEntry = pendingEntries[0]
      if (
        mode === 'update' &&
        (!updateEntry || componentCatalogInstallStatus(
          updateEntry,
          installedBefore[updateEntry.packageId],
        ) !== 'update-available')
      ) {
        throw new UserFacingError(
          '组件更新已取消',
          '工程内组件与目录状态已发生变化。',
          '请刷新组件目录，重新审阅版本和哈希后再试。',
        )
      }
      const updateTarget = mode === 'update' && updateEntry
        ? portsRef.current.captureReplacementTarget(updateEntry.packageId)
        : null
      if (mode === 'update' && !updateTarget) {
        throw new UserFacingError(
          '组件更新已取消',
          '工程内组件替换目标已经失效。',
          '请刷新组件目录，重新审阅版本和哈希后再试。',
        )
      }

      const importedPackages: ComponentPackageData[] = []
      for (const entry of pendingEntries) {
        const file = await portsRef.current.readCatalogPackage({
          sourceId: entry.sourceId,
          packageId: entry.packageId,
          version: entry.version,
        })
        if (file.sha256 !== entry.sha256) {
          throw new UserFacingError(
            '组件目录已改变',
            `组件“${entry.name}”读取到的包哈希与当前目录快照不一致。`,
            '请刷新组件库并重新确认该版本。',
          )
        }
        importedPackages.push(await importComponentPackageAsync(file.bytes, {
          expectedId: entry.packageId,
          expectedVersion: entry.version,
          provenance: {
            sha256: file.sha256,
            importedAt: new Date().toISOString(),
            sourceLabel: entry.sourceLabel,
          },
        }))
      }
      assertSameProject(
        started,
        portsRef.current.captureIdentity(),
        mode === 'update' ? '组件更新已取消' : '组件加入已取消',
        '请刷新组件目录，重新审阅版本和哈希后再试。',
      )
      if (mode === 'update') {
        const result = portsRef.current.replacePackageAtTarget(
          updateTarget!,
          importedPackages[0]!,
        )
        if (!result.ok) {
          throw new UserFacingError(
            '组件更新已取消',
            result.reason ?? '工程或组件状态已发生变化，请刷新组件目录后重试。',
            '工程或组件状态已发生变化，请刷新组件目录后重试。',
          )
        }
        return true
      }
      const latestPackages = portsRef.current.readInstalledPackages()
      for (const entry of pendingEntries) {
        if (componentCatalogInstallStatus(
          entry,
          latestPackages[entry.packageId],
        ) !== 'available') {
          throw new UserFacingError(
            '组件加入已取消',
            '工程内组件状态在目录读取期间发生变化。',
            '请返回组件库重新选择，避免覆盖刚刚完成的修改。',
          )
        }
      }
      portsRef.current.importPackages(importedPackages)
      portsRef.current.commitStatus(`已加入 ${importedPackages.length} 个组件`)
      return true
    }, mode === 'update'
      ? '组件更新失败，工程内原版本已保留。'
      : '目录组件嵌入失败，工程未改变。')
    return completed === true
  }, [])

  const addCatalogPackages = useCallback(async (
    entries: AvailableComponentCatalogPackage[],
  ): Promise<boolean> => {
    const installed = portsRef.current.readInstalledPackages()
    const plan = planCatalogBatchJoin(entries, installed)
    const pendingEntries = plan.entries
    if (pendingEntries.length === 0) {
      portsRef.current.commitStatus('所选组件均已加入工程')
      return true
    }
    return performCatalogPackageOperation(pendingEntries, 'add')
  }, [performCatalogPackageOperation])

  const requestCatalogUpdate = useCallback((
    entry: AvailableComponentCatalogPackage,
  ) => {
    setCatalogUpdateRequest({ entries: [entry], mode: 'update' })
  }, [])

  const confirmCatalogUpdate = useCallback(() => {
    const request = catalogUpdateRequest
    setCatalogUpdateRequest(null)
    if (!request) return
    void performCatalogPackageOperation(request.entries, request.mode)
  }, [catalogUpdateRequest, performCatalogPackageOperation])

  const cancelCatalogUpdate = useCallback(() => {
    setCatalogUpdateRequest(null)
  }, [])

  const refreshCatalog = useCallback(() => {
    void portsRef.current.runBusy(async () => {
      setComponentCatalog(await portsRef.current.loadCatalog())
    }, '组件目录刷新失败。')
  }, [])

  useEffect(() => {
    if (!portsRef.current.desktopAvailable()) return
    let cancelled = false
    void portsRef.current.loadCatalog().then((snapshot) => {
      if (!cancelled) setComponentCatalog(snapshot)
    }).catch((error) => {
      if (cancelled) return
      console.error('读取组件目录失败', error)
      portsRef.current.reportError('本地组件目录读取失败；仍可手动导入 .h5component。')
    })
    return () => { cancelled = true }
  }, [])

  return {
    componentCatalog,
    replacementRequest,
    catalogUpdateRequest,
    importExternalPackages,
    replacePackage,
    refreshCatalog,
    addCatalogPackages,
    requestCatalogUpdate,
    confirmReplacement,
    cancelReplacement,
    confirmCatalogUpdate,
    cancelCatalogUpdate,
  }
}
