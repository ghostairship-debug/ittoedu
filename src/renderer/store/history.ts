import type { Patch } from 'immer'
import { MAX_HISTORY_STEPS } from '../../shared/constants'
import {
  cloneHistoryResourceChanges,
  historyResourceChangesAreEmpty,
  type HistoryResourceChanges,
} from './courseResourceState'

export type {
  AssetFileHistoryChange,
  ComponentPackageHistoryChange,
  HistoryResourceChanges,
  HistoryResourceDirection,
  HistoryResourceState,
} from './courseResourceState'

export {
  applyAssetFileHistoryChanges,
  applyComponentPackageHistoryChanges,
  applyHistoryResourceChanges,
  cloneAssetFileHistoryChange,
  cloneComponentPackageHistoryChange,
  cloneHistoryResourceChanges,
  historyResourceChangesAreEmpty,
  planAssetFileHistoryChange,
} from './courseResourceState'

export interface HistoryEntry {
  patches: Patch[]
  inversePatches: Patch[]
  /** Keeps executable packages in lockstep with project metadata on undo/redo. */
  componentPackageChanges?: HistoryResourceChanges['componentPackageChanges']
  /** Keeps imported binary resources in lockstep with project asset metadata. */
  assetFileChanges?: HistoryResourceChanges['assetFileChanges']
}

export interface HistoryState {
  past: HistoryEntry[]
  future: HistoryEntry[]
}

export const emptyHistory = (): HistoryState => ({ past: [], future: [] })

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
