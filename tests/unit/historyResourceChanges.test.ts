import { describe, expect, it } from 'vitest'
import type { ComponentPackageData } from '@/shared/componentTypes'
import {
  applyAssetFileHistoryChanges,
  applyComponentPackageHistoryChanges,
  applyHistoryResourceChanges,
  cloneHistoryResourceChanges,
  historyResourceChangesAreEmpty,
  planAssetFileHistoryChange,
} from '@/renderer/store/courseResourceState'

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

  it('detaches Buffer subclasses and preserves prototype-looking resource keys', () => {
    const caller = Buffer.from([13, 21, 34])
    const planned = planAssetFileHistoryChange('__proto__', undefined, caller)
    if (!planned) throw new Error('Expected a resource change')
    caller[0] = 255
    expect([...planned.after!]).toEqual([13, 21, 34])
    expect(planned.after?.constructor).toBe(Uint8Array)

    const forward = applyAssetFileHistoryChanges({}, [planned], 'forward')
    expect(Object.hasOwn(forward, '__proto__')).toBe(true)
    expect(Object.getPrototypeOf(forward)).toBe(Object.prototype)
    expect([...forward['__proto__']!]).toEqual([13, 21, 34])

    const inverse = applyAssetFileHistoryChanges(forward, [planned], 'inverse')
    expect(Object.hasOwn(inverse, '__proto__')).toBe(false)
    expect(Object.getPrototypeOf(inverse)).toBe(Object.prototype)
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
})
