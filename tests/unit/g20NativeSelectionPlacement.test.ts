import { expect, it } from 'vitest'
import { placeQuickBar, rotatedBoundingBox, unionBoxes } from '../../src/renderer/editing/quickbar/placeQuickBar'

const canvas = { left: 300, top: 120, right: 1260, bottom: 820 }
const bar = { width: 320, height: 34 }

function expectInsideCanvas(position: ReturnType<typeof placeQuickBar>, size = bar) {
  expect(position.left).toBeGreaterThanOrEqual(canvas.left)
  expect(position.top).toBeGreaterThanOrEqual(canvas.top)
  expect(position.left + size.width).toBeLessThanOrEqual(canvas.right)
  expect(position.top + size.height).toBeLessThanOrEqual(canvas.bottom)
}

it('M21 puts the quick bar above the selection, left-aligned, like the text editing toolbar', () => {
  const anchor = { left: 500, top: 400, width: 200, height: 100 }
  const position = placeQuickBar(anchor, canvas, bar)
  expect(position).toEqual({ left: 500, top: 400 - 8 - 34, placement: 'above' })
  expect(position.top + bar.height).toBeLessThanOrEqual(anchor.top)
})

it('M21 flips below a selection at the top edge without covering it', () => {
  const anchor = { left: 500, top: 130, width: 200, height: 100 }
  const position = placeQuickBar(anchor, canvas, bar)
  expect(position.placement).toBe('below')
  expect(position.top).toBeGreaterThanOrEqual(anchor.top + anchor.height)
  expectInsideCanvas(position)
})

it('M21 pins inside the top of a selection taller than the view, still inside the canvas', () => {
  const position = placeQuickBar({ left: 320, top: 100, width: 600, height: 900 }, canvas, bar)
  expect(position.placement).toBe('inside')
  expectInsideCanvas(position)
})

it('M21 clamps a selection near the right edge so the whole bar stays visible', () => {
  const position = placeQuickBar({ left: 1200, top: 500, width: 50, height: 50 }, canvas, bar)
  expect(position.left + bar.width).toBeLessThanOrEqual(canvas.right - 8)
  expectInsideCanvas(position)
})

it('M21 anchors rotated and multiple objects by their visible union', () => {
  const rotated = rotatedBoundingBox({ left: 0, top: 0, width: 100, height: 20, rotation: 90 })
  expect(rotated.width).toBeCloseTo(20)
  expect(rotated.height).toBeCloseTo(100)
  expect(rotated.left).toBeCloseTo(40)
  expect(rotated.top).toBeCloseTo(-40)
  expect(unionBoxes([{ left: 10, top: 20, width: 30, height: 40 }, { left: 100, top: 5, width: 10, height: 10 }]))
    .toEqual({ left: 10, top: 5, width: 100, height: 55 })
  expect(unionBoxes([])).toBeNull()
})
