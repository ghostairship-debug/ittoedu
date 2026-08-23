import type { Patch } from 'immer'
import type { ComponentPackageData } from '../../shared/componentTypes'
import type { ProjectDocument } from '../../shared/projectTypes'
import { MAX_HISTORY_STEPS } from '../../shared/constants'

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

export interface HistoryEntry {
  patches: Patch[]
  inversePatches: Patch[]
  /** Keeps executable packages in lockstep with project metadata on undo/redo. */
  componentPackageChanges?: ComponentPackageHistoryChange[]
  /** Keeps imported binary resources in lockstep with project asset metadata. */
  assetFileChanges?: AssetFileHistoryChange[]
}

export interface HistoryState {
  past: HistoryEntry[]
  future: HistoryEntry[]
}

export const emptyHistory = (): HistoryState => ({ past: [], future: [] })

export function cloneProject(project: ProjectDocument): ProjectDocument {
  return structuredClone(project)
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
    ...(before === undefined ? {} : { before: before.slice() }),
    ...(after === undefined ? {} : { after: after.slice() }),
  })
}

export function cloneAssetFileHistoryChange(
  change: AssetFileHistoryChange,
): AssetFileHistoryChange {
  return Object.freeze({
    assetId: change.assetId,
    ...(change.before === undefined ? {} : { before: change.before.slice() }),
    ...(change.after === undefined ? {} : { after: change.after.slice() }),
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
    else nextFiles[change.assetId] = value.slice()
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
    else nextPackages[change.packageId] = structuredClone(value)
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

export function pushHistory(
  history: HistoryState,
  patches: Patch[],
  inversePatches: Patch[],
  resourceChanges: HistoryResourceChanges = {},
): HistoryState {
  const clonedResourceChanges = cloneHistoryResourceChanges(resourceChanges)
  const componentPackageChanges = clonedResourceChanges.componentPackageChanges
  const assetFileChanges = clonedResourceChanges.assetFileChanges
  if (
    patches.length === 0 &&
    historyResourceChangesAreEmpty(clonedResourceChanges)
  ) {
    return history
  }
  return {
    past: [
      ...history.past,
      {
        patches,
        inversePatches,
        ...(componentPackageChanges?.length
          ? { componentPackageChanges }
          : {}),
        ...(assetFileChanges?.length ? { assetFileChanges } : {}),
      },
    ].slice(-MAX_HISTORY_STEPS),
    future: [],
  }
}
