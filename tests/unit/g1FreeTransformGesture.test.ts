// @vitest-environment node
import { expect, it } from 'vitest'
import { IDENTITY_MATRIX } from '../../src/core/components/geometry'
import { FreeTransformGesture } from '../../src/renderer/componentPlatform/surfaces/slide/freeTransformGesture'
import type { FreeObjectTarget } from '../../src/renderer/componentPlatform/surfaces/slide/targets'

function target(id: string, x: number, y: number): FreeObjectTarget {
  return {
    instanceId: id, frame: { width: 20, height: 20, transform: [1, 0, 0, 1, x, y] },
    parentToSurface: IDENTITY_MATRIX, parent: { kind: 'surface', surfaceId: 'slide' },
    ancestors: [], preserveAspectRatio: false,
  }
}

it('keeps the Shift drag axis when snapping reaches the starting position', () => {
  const original = target('selected', 100, 100)
  const gesture = new FreeTransformGesture({ mode: 'drag', targets: [original],
    pointer: { x: 110, y: 110 }, surfaceToPointer: IDENTITY_MATRIX,
    snapTargets: [target('neighbor', 100, 103)] })
  const update = gesture.update({ x: 114, y: 111 }, { shift: true })
  const edit = update.edits[0]!
  if (edit.type !== 'frame.set' || !edit.frame) throw new Error('Expected a frame edit')
  expect(edit.frame.transform).toEqual(original.frame.transform)
  expect(update.guides).toEqual([{ axis: 'x', value: 100 }])
  expect(original.frame.transform).toEqual([1, 0, 0, 1, 100, 100])
})

it('keeps vertical Shift dragging vertical while snapping the unlocked axis', () => {
  const original = target('selected', 100, 100)
  const gesture = new FreeTransformGesture({ mode: 'drag', targets: [original],
    pointer: { x: 110, y: 110 }, surfaceToPointer: IDENTITY_MATRIX,
    snapTargets: [target('neighbor', 103, 100)] })
  const update = gesture.update({ x: 111, y: 114 }, { shift: true })
  const edit = update.edits[0]!
  if (edit.type !== 'frame.set' || !edit.frame) throw new Error('Expected a frame edit')
  expect(edit.frame.transform).toEqual(original.frame.transform)
  expect(update.guides).toEqual([{ axis: 'y', value: 100 }])
})
