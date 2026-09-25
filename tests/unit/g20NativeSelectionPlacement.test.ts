import { expect, it } from 'vitest'
import { placeSelectionPopover } from '../../src/renderer/workbench/NativeSelectionContext'

const canvas = { left: 348, top: 278, right: 1492, bottom: 842 }
const panel = { width: 340, height: 434 }

function expectInsideCanvas(position: ReturnType<typeof placeSelectionPopover>) {
  expect(position.left).toBeGreaterThanOrEqual(canvas.left + 8)
  expect(position.top).toBeGreaterThanOrEqual(canvas.top + 8)
  expect(position.left + position.maxWidth).toBeLessThanOrEqual(canvas.right - 8)
  expect(position.top + position.maxHeight).toBeLessThanOrEqual(canvas.bottom - 8)
}

it('keeps a tall AI image property card below the document toolbar when the image is near the canvas bottom', () => {
  const position = placeSelectionPopover({ left: 1006, top: 662, width: 235, height: 145 }, canvas, panel)
  expectInsideCanvas(position)
  expect(position.top).toBeGreaterThanOrEqual(canvas.top + 8)
})

it('places a property card below a top-edge selection when there is room', () => {
  const anchor = { left: 530, top: 300, width: 160, height: 54 }
  const position = placeSelectionPopover(anchor, canvas, { width: 340, height: 240 })
  expect(position.top).toBe(anchor.top + anchor.height + 8)
  expectInsideCanvas(position)
})

it('flips a lower selection above its anchor when the whole card fits there', () => {
  const anchor = { left: 530, top: 710, width: 160, height: 54 }
  const position = placeSelectionPopover(anchor, canvas, { width: 340, height: 240 })
  expect(position.top + position.maxHeight).toBe(anchor.top - 8)
  expectInsideCanvas(position)
})

it('caps an oversized card to the content viewport so the panel can scroll internally', () => {
  const position = placeSelectionPopover({ left: 1400, top: 800, width: 130, height: 60 }, canvas, { width: 340, height: 900 })
  expect(position.maxHeight).toBe(canvas.bottom - canvas.top - 16)
  expectInsideCanvas(position)
})

it('caps width when the content area is narrower than the card', () => {
  const narrow = { left: 350, top: 280, right: 600, bottom: 840 }
  const position = placeSelectionPopover({ left: 550, top: 500, width: 80, height: 80 }, narrow, { width: 340, height: 250 })
  expect(position.maxWidth).toBe(234)
  expect(position.left).toBeGreaterThanOrEqual(narrow.left + 8)
  expect(position.left + position.maxWidth).toBeLessThanOrEqual(narrow.right - 8)
})
