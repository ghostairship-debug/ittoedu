// @vitest-environment node
import { expect, it } from 'vitest'
import { IDENTITY_MATRIX, frameCorners, transformPoint } from '../../src/core/components/geometry'
import { FreeTransformGesture, LocalAuthorTransformGesture } from '../../src/renderer/componentPlatform/surfaces/slide/freeTransformGesture'
import type { FreeObjectTarget } from '../../src/renderer/componentPlatform/surfaces/slide/targets'

const target = (image = false): FreeObjectTarget => ({ instanceId: 'local-target', frame: { width: 200, height: 100, transform: [1, 0, 0, 1, 40, 30] },
  parentToSurface: [2, 0, 0, 2, 80, 50], parent: { kind: 'instance', instanceId: 'web' }, ancestors: ['web'], preserveAspectRatio: image })

it('resizes text content width through the parent and host matrix once without scaling glyphs or changing neighbors', () => {
  const original = target(), frozen = structuredClone(original), host = [0.5, 0, 0, 0.5, 100, 20] as const
  const corner = frameCorners(original.frame, original.parentToSurface)[1], pointer = transformPoint(host, corner)
  const gesture = new FreeTransformGesture({ mode: 'resize', resizeMode: 'box', handle: 'e', targets: [original], pointer, surfaceToPointer: host })
  const [edit] = gesture.update({ x: pointer.x + 80, y: pointer.y }).edits
  if (edit.type !== 'frame.set' || !edit.frame) throw new Error('Expected content box')
  expect(edit.frame).toEqual({ width: 280, height: 100, transform: [1, 0, 0, 1, 40, 30] })
  expect(original).toEqual(frozen)
})

it('scales an image uniformly and starts every update from its frozen frame', () => {
  const original = target(true), pointer = frameCorners(original.frame, original.parentToSurface)[1]
  const gesture = new FreeTransformGesture({ mode: 'resize', handle: 'e', targets: [original], pointer, surfaceToPointer: IDENTITY_MATRIX })
  gesture.update({ x: pointer.x + 20, y: pointer.y })
  const [edit] = gesture.update({ x: pointer.x + 200, y: pointer.y }).edits
  if (edit.type !== 'frame.set' || !edit.frame) throw new Error('Expected image scaling')
  expect(edit.frame.width).toBe(200)
  expect(edit.frame.height).toBe(100)
  expect(edit.frame.transform.slice(0, 4)).toEqual([1.5, 0, 0, 1.5])
})

it('compiles border-box width and parent-scaled movement into existing content-box and author increments', () => {
  const geometry = { frame: { width: 240, height: 80, transform: [1, 0, 0, 1, 40, 30] as [number, number, number, number, number, number] },
    parentToInstance: [2, 0, 0, 2, 80, 50] as [number, number, number, number, number, number], author: { translateX: 12, width: 200 }, boxInsets: { width: 40, height: 20 } }
  const root = [0.5, 0, 0, 0.5, 0, 0] as const, pointer = transformPoint(root, frameCorners(geometry.frame, geometry.parentToInstance)[1])
  const resize = new LocalAuthorTransformGesture({ geometry, kind: 'text', mode: 'resize', handle: 'e', rootToSurface: root, surfaceToPointer: IDENTITY_MATRIX, pointer })
  expect(resize.update({ x: pointer.x + 60, y: pointer.y }).geometry).toEqual({ width: 260 })
  const drag = new LocalAuthorTransformGesture({ geometry, kind: 'text', mode: 'drag', rootToSurface: root, surfaceToPointer: IDENTITY_MATRIX, pointer })
  drag.update({ x: pointer.x + 10, y: pointer.y })
  expect(drag.update({ x: pointer.x + 50, y: pointer.y }).geometry).toEqual({ translateX: 62 })
  expect(geometry.author).toEqual({ translateX: 12, width: 200 })
})
