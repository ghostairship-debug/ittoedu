import type { Patch } from 'immer'
import { describe, expect, it } from 'vitest'
import type { ComponentPackageData } from '@/shared/componentTypes'
import { MAX_HISTORY_STEPS } from '@/shared/constants'
import {
  applyAssetFileHistoryChanges,
  applyComponentPackageHistoryChanges,
  applyHistoryResourceChanges,
  cloneHistoryResourceChanges,
  emptyHistory,
  historyResourceChangesAreEmpty,
  planAssetFileHistoryChange,
  pushHistory,
  type HistoryEntry,
} from '@/renderer/store/history'

function componentPackage(
  id: string,
  fileBytes: Uint8Array,
): ComponentPackageData {
  return {
    manifest: {
      id,
      name: id,
      version: '1.0.0',
      entry: 'index.js',
      schemaVersion: 4,
      runtimeApiVersion: 4,
      defaultSize: { width: 320, height: 180 },
      minSize: { width: 80, height: 45 },
      preserveAspectRatio: true,
      assets: {},
      defaultProps: {},
      supportedScopes: ['scene'],
      renderMode: 'dom',
    },
    runtimeSource: 'export default {}',
    files: { 'index.js': fileBytes },
  }
}

describe('History resource changes', () => {
  it('plans cloned add/remove/replace bytes and drops byte-identical no-ops', () => {
    const addedBytes = new Uint8Array([1, 2, 3])
    const removedBytes = new Uint8Array([4, 5, 6])
    const beforeReplacement = new Uint8Array([7, 8])
    const afterReplacement = new Uint8Array([9, 10, 11])

    const add = planAssetFileHistoryChange('added', undefined, addedBytes)
    const remove = planAssetFileHistoryChange('removed', removedBytes, undefined)
    const replace = planAssetFileHistoryChange(
      'replaced',
      beforeReplacement,
      afterReplacement,
    )

    expect(add).toEqual({ assetId: 'added', after: addedBytes })
    expect(remove).toEqual({ assetId: 'removed', before: removedBytes })
    expect(replace).toEqual({
      assetId: 'replaced',
      before: beforeReplacement,
      after: afterReplacement,
    })
    expect(planAssetFileHistoryChange('empty', undefined, undefined)).toBeNull()
    expect(planAssetFileHistoryChange(
      'same',
      new Uint8Array([1, 2]),
      new Uint8Array([1, 2]),
    )).toBeNull()
    expect(() => planAssetFileHistoryChange('  ', undefined, addedBytes))
      .toThrow(/assetId/)

    addedBytes[0] = 99
    removedBytes[0] = 99
    beforeReplacement[0] = 99
    afterReplacement[0] = 99
    expect([...add!.after!]).toEqual([1, 2, 3])
    expect([...remove!.before!]).toEqual([4, 5, 6])
    expect([...replace!.before!]).toEqual([7, 8])
    expect([...replace!.after!]).toEqual([9, 10, 11])
  })

  it('applies asset add/remove/replace forward and inverse without byte aliases', () => {
    const changes = cloneHistoryResourceChanges({
      assetFileChanges: [
        { assetId: 'added', after: new Uint8Array([1, 2, 3]) },
        { assetId: 'removed', before: new Uint8Array([4, 5, 6]) },
        {
          assetId: 'replaced',
          before: new Uint8Array([7, 8]),
          after: new Uint8Array([9, 10, 11]),
        },
      ],
    })
    const original = {
      removed: new Uint8Array([4, 5, 6]),
      replaced: new Uint8Array([7, 8]),
      untouched: new Uint8Array([12]),
    }

    const forward = applyAssetFileHistoryChanges(
      original,
      changes.assetFileChanges,
      'forward',
    )
    expect(forward.removed).toBeUndefined()
    expect([...forward.added!]).toEqual([1, 2, 3])
    expect([...forward.replaced!]).toEqual([9, 10, 11])
    expect([...forward.untouched!]).toEqual([12])
    expect(forward.untouched).toBe(original.untouched)
    expect(forward.replaced).not.toBe(changes.assetFileChanges![2]!.after)

    forward.added![0] = 88
    expect([...changes.assetFileChanges![0]!.after!]).toEqual([1, 2, 3])

    const inverse = applyAssetFileHistoryChanges(
      forward,
      changes.assetFileChanges,
      'inverse',
    )
    expect(inverse.added).toBeUndefined()
    expect([...inverse.removed!]).toEqual([4, 5, 6])
    expect([...inverse.replaced!]).toEqual([7, 8])
  })

  it('clones and reverses component packages through the same resource state', () => {
    const before = componentPackage('com.example.widget', new Uint8Array([1, 2]))
    const after = componentPackage('com.example.widget', new Uint8Array([3, 4]))
    const changes = cloneHistoryResourceChanges({
      componentPackageChanges: [{
        packageId: before.manifest.id,
        before,
        after,
      }],
      assetFileChanges: [{
        assetId: 'image',
        before: new Uint8Array([5]),
        after: new Uint8Array([6]),
      }],
    })
    before.files['index.js']![0] = 99
    after.files['index.js']![0] = 99

    const forwardPackages = applyComponentPackageHistoryChanges(
      { [before.manifest.id]: componentPackage(before.manifest.id, new Uint8Array([1, 2])) },
      changes.componentPackageChanges,
      'forward',
    )
    expect([...forwardPackages[before.manifest.id]!.files['index.js']!])
      .toEqual([3, 4])
    forwardPackages[before.manifest.id]!.files['index.js']![0] = 88
    expect([
      ...changes.componentPackageChanges![0]!.after!.files['index.js']!,
    ]).toEqual([3, 4])

    const forward = applyHistoryResourceChanges({
      componentPackages: {
        [before.manifest.id]: componentPackage(before.manifest.id, new Uint8Array([1, 2])),
      },
      assetFiles: { image: new Uint8Array([5]) },
    }, changes, 'forward')
    const inverse = applyHistoryResourceChanges(forward, changes, 'inverse')
    expect([...inverse.componentPackages[before.manifest.id]!.files['index.js']!])
      .toEqual([1, 2])
    expect([...inverse.assetFiles.image!]).toEqual([5])
  })

  it('keeps one resource-only step, clears future, drops no-ops, and honors the cap', () => {
    const futureEntry: HistoryEntry = { patches: [], inversePatches: [] }
    const sourceBytes = new Uint8Array([10, 20])
    const initial = {
      ...emptyHistory(),
      future: [futureEntry],
    }
    const resourceOnly = pushHistory(initial, [], [], {
      assetFileChanges: [{ assetId: 'image', after: sourceBytes }],
    })
    expect(resourceOnly.past).toHaveLength(1)
    expect(resourceOnly.future).toEqual([])
    sourceBytes[0] = 99
    expect([...resourceOnly.past[0]!.assetFileChanges![0]!.after!])
      .toEqual([10, 20])

    const noOp = pushHistory(resourceOnly, [], [], {
      assetFileChanges: [{
        assetId: 'image',
        before: new Uint8Array([10, 20]),
        after: new Uint8Array([10, 20]),
      }],
    })
    expect(noOp).toBe(resourceOnly)
    expect(historyResourceChangesAreEmpty(cloneHistoryResourceChanges({
      assetFileChanges: [{
        assetId: 'image',
        before: new Uint8Array([1]),
        after: new Uint8Array([1]),
      }],
    }))).toBe(true)

    let capped = resourceOnly
    for (let index = 0; index < MAX_HISTORY_STEPS + 5; index += 1) {
      const patch: Patch = {
        op: 'replace',
        path: ['revision'],
        value: index,
      }
      capped = pushHistory(capped, [patch], [])
    }
    expect(capped.past).toHaveLength(MAX_HISTORY_STEPS)
    expect(capped.future).toEqual([])
  })
})
