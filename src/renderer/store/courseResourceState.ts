import type { ComponentPackageData } from '../../shared/componentTypes'
import type { CourseProjectDocument } from '../../shared/courseProjectTypes'
import {
  emptyCourseAssetSidecar,
  freezeCourseAssetSidecar,
  type CourseAssetSidecar,
} from '../project/v9AssetAdapter'

export interface ComponentPackageHistoryChange {
  packageId: string
  before?: ComponentPackageData
  after?: ComponentPackageData
}

export interface AssetFileHistoryChange {
  assetId: string
  before?: Uint8Array
  after?: Uint8Array
}

export interface HistoryResourceChanges {
  componentPackageChanges?: ComponentPackageHistoryChange[]
  assetFileChanges?: AssetFileHistoryChange[]
}

export type HistoryResourceDirection = 'forward' | 'inverse'

export interface HistoryResourceState {
  readonly componentPackages: Readonly<Record<string, ComponentPackageData>>
  readonly assetFiles: Readonly<Record<string, Uint8Array>>
}

export interface CourseResourceState {
  courseAssetSidecar: CourseAssetSidecar | null
  courseAssetSidecarPast: CourseAssetSidecar[]
  courseAssetSidecarFuture: CourseAssetSidecar[]
  courseComponentPackagesPast: Record<string, ComponentPackageData>[]
  courseComponentPackagesFuture: Record<string, ComponentPackageData>[]
  componentPackages: Record<string, ComponentPackageData>
  assetFiles: Record<string, Uint8Array>
}

export interface CourseResourceHistoryContinuation {
  readonly sidecarPast: CourseAssetSidecar[]
  readonly sidecarFuture: CourseAssetSidecar[]
  readonly componentPackagesPast: Record<string, ComponentPackageData>[]
  readonly componentPackagesFuture: Record<string, ComponentPackageData>[]
}

export interface CourseResourceTransition {
  readonly resourceChanges: HistoryResourceChanges
  readonly resourceDirection: HistoryResourceDirection
}

export interface CourseResourceCommitInput {
  readonly sidecar?: CourseAssetSidecar
  readonly sidecarDirection?: 'undo' | 'redo'
  readonly componentPackages?: Record<string, ComponentPackageData>
  readonly appliedResources?: HistoryResourceState | null
  readonly historyEntry?: boolean
  readonly document: CourseProjectDocument
  readonly legacyPastCount: number
  readonly legacyFutureCount: number
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false
  return left.every((value, index) => value === right[index])
}

function cloneComponentPackage(
  value: ComponentPackageData | undefined,
): ComponentPackageData | undefined {
  return value === undefined ? undefined : structuredClone(value)
}

function defineRecordValue<T>(record: Record<string, T>, key: string, value: T): void {
  Object.defineProperty(record, key, {
    value,
    enumerable: true,
    configurable: true,
    writable: true,
  })
}

export function planAssetFileHistoryChange(
  assetId: string,
  before: Uint8Array | undefined,
  after: Uint8Array | undefined,
): AssetFileHistoryChange | null {
  if (!assetId.trim()) throw new TypeError('assetId 不能为空')
  if (
    (before === undefined && after === undefined) ||
    (before !== undefined && after !== undefined && sameBytes(before, after))
  ) {
    return null
  }
  return Object.freeze({
    assetId,
    ...(before === undefined ? {} : { before: Uint8Array.from(before) }),
    ...(after === undefined ? {} : { after: Uint8Array.from(after) }),
  })
}

export function cloneAssetFileHistoryChange(
  change: AssetFileHistoryChange,
): AssetFileHistoryChange {
  return Object.freeze({
    assetId: change.assetId,
    ...(change.before === undefined ? {} : { before: Uint8Array.from(change.before) }),
    ...(change.after === undefined ? {} : { after: Uint8Array.from(change.after) }),
  })
}

export function cloneComponentPackageHistoryChange(
  change: ComponentPackageHistoryChange,
): ComponentPackageHistoryChange {
  return Object.freeze({
    packageId: change.packageId,
    ...(change.before === undefined
      ? {}
      : { before: cloneComponentPackage(change.before) }),
    ...(change.after === undefined
      ? {}
      : { after: cloneComponentPackage(change.after) }),
  })
}

export function cloneHistoryResourceChanges(
  changes: HistoryResourceChanges = {},
): HistoryResourceChanges {
  const componentPackageChanges = changes.componentPackageChanges
    ?.filter((change) => !(
      change.before === undefined && change.after === undefined
    ) && change.before !== change.after)
    .map(cloneComponentPackageHistoryChange)
  const assetFileChanges = changes.assetFileChanges
    ?.map((change) => planAssetFileHistoryChange(
      change.assetId,
      change.before,
      change.after,
    ))
    .filter((change): change is AssetFileHistoryChange => change !== null)
  return Object.freeze({
    ...(componentPackageChanges?.length
      ? { componentPackageChanges: Object.freeze(componentPackageChanges) as unknown as ComponentPackageHistoryChange[] }
      : {}),
    ...(assetFileChanges?.length
      ? { assetFileChanges: Object.freeze(assetFileChanges) as unknown as AssetFileHistoryChange[] }
      : {}),
  })
}

export function historyResourceChangesAreEmpty(
  changes: HistoryResourceChanges | undefined,
): boolean {
  return !changes?.componentPackageChanges?.length &&
    !changes?.assetFileChanges?.length
}

export function applyAssetFileHistoryChanges(
  files: Readonly<Record<string, Uint8Array>>,
  changes: readonly AssetFileHistoryChange[] | undefined,
  direction: HistoryResourceDirection,
): Readonly<Record<string, Uint8Array>> {
  if (!changes?.length) return files
  const nextFiles = { ...files }
  for (const change of changes ?? []) {
    const value = direction === 'forward' ? change.after : change.before
    if (value === undefined) delete nextFiles[change.assetId]
    else defineRecordValue(nextFiles, change.assetId, Uint8Array.from(value))
  }
  return Object.freeze(nextFiles)
}

export function applyComponentPackageHistoryChanges(
  packages: Readonly<Record<string, ComponentPackageData>>,
  changes: readonly ComponentPackageHistoryChange[] | undefined,
  direction: HistoryResourceDirection,
): Readonly<Record<string, ComponentPackageData>> {
  if (!changes?.length) return packages
  const nextPackages = { ...packages }
  for (const change of changes ?? []) {
    const value = direction === 'forward' ? change.after : change.before
    if (value === undefined) delete nextPackages[change.packageId]
    else defineRecordValue(nextPackages, change.packageId, structuredClone(value))
  }
  return Object.freeze(nextPackages)
}

export function applyHistoryResourceChanges(
  state: HistoryResourceState,
  changes: HistoryResourceChanges,
  direction: HistoryResourceDirection,
): HistoryResourceState {
  return Object.freeze({
    componentPackages: applyComponentPackageHistoryChanges(
      state.componentPackages,
      changes.componentPackageChanges,
      direction,
    ),
    assetFiles: applyAssetFileHistoryChanges(
      state.assetFiles,
      changes.assetFileChanges,
      direction,
    ),
  })
}

export function cloneCourseAssetSidecar(sidecar: CourseAssetSidecar): CourseAssetSidecar {
  return freezeCourseAssetSidecar(sidecar.files)
}

export function projectedAssetFiles(
  sidecar: CourseAssetSidecar | null | undefined,
): Record<string, Uint8Array> {
  if (!sidecar) return {}
  return Object.fromEntries(
    Object.entries(sidecar.files).map(([assetId, bytes]) => [assetId, bytes.slice()]),
  )
}

export function emptyCourseResourceStacks(): Pick<
  CourseResourceState,
  | 'courseAssetSidecar'
  | 'courseAssetSidecarPast'
  | 'courseAssetSidecarFuture'
  | 'courseComponentPackagesPast'
  | 'courseComponentPackagesFuture'
> {
  return {
    courseAssetSidecar: emptyCourseAssetSidecar(),
    courseAssetSidecarPast: [],
    courseAssetSidecarFuture: [],
    courseComponentPackagesPast: [],
    courseComponentPackagesFuture: [],
  }
}

export function continuedCourseResourceStacks(
  continuation?: CourseResourceHistoryContinuation,
): Pick<
  CourseResourceState,
  | 'courseAssetSidecarPast'
  | 'courseAssetSidecarFuture'
  | 'courseComponentPackagesPast'
  | 'courseComponentPackagesFuture'
> {
  if (!continuation) {
    return {
      courseAssetSidecarPast: [],
      courseAssetSidecarFuture: [],
      courseComponentPackagesPast: [],
      courseComponentPackagesFuture: [],
    }
  }
  return {
    courseAssetSidecarPast: continuation.sidecarPast,
    courseAssetSidecarFuture: continuation.sidecarFuture,
    courseComponentPackagesPast: continuation.componentPackagesPast,
    courseComponentPackagesFuture: continuation.componentPackagesFuture,
  }
}

export function commitCourseResourceState(
  current: CourseResourceState,
  input: CourseResourceCommitInput,
): Pick<
  CourseResourceState,
  | 'courseAssetSidecar'
  | 'courseAssetSidecarPast'
  | 'courseAssetSidecarFuture'
  | 'courseComponentPackagesPast'
  | 'courseComponentPackagesFuture'
  | 'componentPackages'
  | 'assetFiles'
> {
  if (
    input.appliedResources
    && (input.sidecar || input.sidecarDirection)
  ) {
    throw new Error('资源事务不能同时使用完整 sidecar 快照')
  }
  const presentSidecar = current.courseAssetSidecar ?? emptyCourseAssetSidecar()
  let nextSidecar = input.sidecar ? cloneCourseAssetSidecar(input.sidecar) : presentSidecar
  let nextPast = current.courseAssetSidecarPast
  let nextFuture = current.courseAssetSidecarFuture
  let nextPackagePast = current.courseComponentPackagesPast ?? []
  let nextPackageFuture = current.courseComponentPackagesFuture ?? []
  let nextPackages: Record<string, ComponentPackageData> = {
    ...current.componentPackages,
    ...(input.componentPackages ?? {}),
  }
  const resources = input.appliedResources ?? null
  const resourceAware = resources !== null
  if (resources) {
    nextSidecar = freezeCourseAssetSidecar(resources.assetFiles)
    nextPackages = { ...resources.componentPackages }
    if (input.historyEntry) {
      nextFuture = []
      nextPackageFuture = []
    }
  } else if (input.sidecarDirection === 'undo') {
    const previous = current.courseAssetSidecarPast.at(-1)
    if (previous) {
      nextFuture = [presentSidecar, ...current.courseAssetSidecarFuture]
      nextSidecar = previous
      nextPast = current.courseAssetSidecarPast.slice(0, -1)
    }
    const previousPackages = (current.courseComponentPackagesPast ?? []).at(-1)
    if (previousPackages) {
      nextPackageFuture = [current.componentPackages, ...(current.courseComponentPackagesFuture ?? [])]
      nextPackages = previousPackages
      nextPackagePast = (current.courseComponentPackagesPast ?? []).slice(0, -1)
    }
  } else if (input.sidecarDirection === 'redo') {
    const upcoming = current.courseAssetSidecarFuture[0]
    if (upcoming) {
      nextPast = [...current.courseAssetSidecarPast, presentSidecar]
      nextSidecar = upcoming
      nextFuture = current.courseAssetSidecarFuture.slice(1)
    }
    const upcomingPackages = (current.courseComponentPackagesFuture ?? [])[0]
    if (upcomingPackages) {
      nextPackagePast = [...(current.courseComponentPackagesPast ?? []), current.componentPackages]
      nextPackages = upcomingPackages
      nextPackageFuture = (current.courseComponentPackagesFuture ?? []).slice(1)
    }
  } else if (input.historyEntry) {
    nextPast = [...current.courseAssetSidecarPast, presentSidecar]
    nextFuture = []
    nextSidecar = input.sidecar ? cloneCourseAssetSidecar(input.sidecar) : presentSidecar
    nextPackagePast = [...(current.courseComponentPackagesPast ?? []), current.componentPackages]
    nextPackageFuture = []
    nextPackages = {
      ...current.componentPackages,
      ...(input.componentPackages ?? {}),
    }
  } else if (input.sidecar) {
    nextSidecar = cloneCourseAssetSidecar(input.sidecar)
  }

  nextPast = input.legacyPastCount === nextPast.length
    ? nextPast
    : input.legacyPastCount === 0
      ? []
      : nextPast.slice(-input.legacyPastCount)
  nextFuture = input.legacyFutureCount === nextFuture.length
    ? nextFuture
    : nextFuture.slice(0, input.legacyFutureCount)
  nextPackagePast = input.legacyPastCount === nextPackagePast.length
    ? nextPackagePast
    : input.legacyPastCount === 0
      ? []
      : nextPackagePast.slice(-input.legacyPastCount)
  nextPackageFuture = input.legacyFutureCount === nextPackageFuture.length
    ? nextPackageFuture
    : nextPackageFuture.slice(0, input.legacyFutureCount)

  const presentPackageIds = new Set(Object.keys(input.document.componentPackages))
  const filteredComponentPackages = Object.fromEntries(
    Object.entries(nextPackages).filter(([packageId]) => presentPackageIds.has(packageId)),
  ) as Record<string, ComponentPackageData>
  const currentPackageIds = Object.keys(current.componentPackages)
  const nextComponentPackages =
    !resourceAware && !input.componentPackages && !input.sidecarDirection
      ? current.componentPackages
      : currentPackageIds.length === Object.keys(filteredComponentPackages).length
        && currentPackageIds.every(
          (packageId) => filteredComponentPackages[packageId] === current.componentPackages[packageId],
        )
        ? current.componentPackages
        : filteredComponentPackages

  return {
    courseAssetSidecar: nextSidecar,
    courseAssetSidecarPast: nextPast,
    courseAssetSidecarFuture: nextFuture,
    courseComponentPackagesPast: nextPackagePast,
    courseComponentPackagesFuture: nextPackageFuture,
    componentPackages: nextComponentPackages,
    assetFiles: projectedAssetFiles(nextSidecar),
  }
}

export function readCourseResourceState(
  state: CourseResourceState,
): CourseResourceState {
  return {
    courseAssetSidecar: state.courseAssetSidecar,
    courseAssetSidecarPast: state.courseAssetSidecarPast,
    courseAssetSidecarFuture: state.courseAssetSidecarFuture,
    courseComponentPackagesPast: state.courseComponentPackagesPast,
    courseComponentPackagesFuture: state.courseComponentPackagesFuture,
    componentPackages: state.componentPackages,
    assetFiles: state.assetFiles,
  }
}
