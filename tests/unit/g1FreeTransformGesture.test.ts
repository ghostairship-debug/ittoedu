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

it('resizes a text box in local dimensions while keeping its glyph transform and opposite corner', () => {
  const original: FreeObjectTarget = { ...target('text', 100, 100), resizeMode: 'box',
    frame: { width: 200, height: 80, transform: [0, 1, -1, 0, 250, 100] },
    parentToSurface: [2, 0, 0, 2, 30, 40] }
  const gesture = new FreeTransformGesture({ mode: 'resize', handle: 'w', targets: [original],
    pointer: { x: 450, y: 240 }, surfaceToPointer: IDENTITY_MATRIX })
  const edit = gesture.update({ x: 450, y: 360 }).edits[0]!
  if (edit.type !== 'frame.set' || !edit.frame) throw new Error('Expected a frame edit')
  expect(edit.frame.width).toBeCloseTo(140)
  expect(edit.frame.height).toBe(80)
  expect(edit.frame.transform).toEqual([0, 1, -1, 0, 250, 160])
  expect(original.frame.width).toBe(200)
})

it('retains explicit visual scaling and multi-object scaling for text targets', () => {
  const original: FreeObjectTarget = { ...target('text', 100, 100), resizeMode: 'box' }
  const explicit = new FreeTransformGesture({ mode: 'resize', resizeMode: 'scale', handle: 'e', targets: [original],
    pointer: { x: 120, y: 110 }, surfaceToPointer: IDENTITY_MATRIX }).update({ x: 140, y: 110 }).edits[0]!
  if (explicit.type !== 'frame.set' || !explicit.frame) throw new Error('Expected a frame edit')
  expect(explicit.frame.width).toBe(20)
  expect(explicit.frame.transform).toEqual([2, 0, 0, 1, 100, 100])
  const group = new FreeTransformGesture({ mode: 'resize', handle: 'e', targets: [original, target('other', 140, 100)],
    pointer: { x: 160, y: 110 }, surfaceToPointer: IDENTITY_MATRIX }).update({ x: 220, y: 110 }).edits
  expect(group).toHaveLength(2)
  for (const edit of group) {
    if (edit.type !== 'frame.set' || !edit.frame) throw new Error('Expected a frame edit')
    expect(edit.frame.width).toBe(20)
    expect(edit.frame.transform.slice(0, 4)).toEqual([2, 0, 0, 1])
  }
})
