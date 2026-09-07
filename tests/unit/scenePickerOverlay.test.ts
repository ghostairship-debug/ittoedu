import '@testing-library/jest-dom/vitest'
import { fireEvent } from '@testing-library/dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ScenePickerOverlay } from '../../src/player/ScenePickerOverlay'

const scenes = [
  { id: 'scene_intro', name: '课程导入' },
  { id: 'scene_practice', name: '课堂练习' },
  { id: 'scene_summary', name: '总结提升' },
]

function createStage(): HTMLElement {
  const stage = document.createElement('section')
  stage.style.position = 'relative'
  document.body.append(stage)
  return stage
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('ScenePickerOverlay', () => {
  it('lists scenes in order, highlights the current scene and supports keyboard selection', async () => {
    const stage = createStage()
    const restoreTarget = document.createElement('button')
    restoreTarget.textContent = '画布控制器'
    document.body.prepend(restoreTarget)
    restoreTarget.focus()
    const onSelect = vi.fn()
    const picker = new ScenePickerOverlay({ stage, scenes, onSelect })

    picker.open('scene_practice')
    await Promise.resolve()

    const dialog = stage.querySelector('[role="dialog"][data-scene-picker]')
    const buttons = [...stage.querySelectorAll<HTMLButtonElement>(
      '.lesson-scene-picker__item',
    )]
    expect(dialog).toHaveAccessibleName('场景目录')
    expect(buttons.map((button) => button.dataset.sceneId)).toEqual([
      'scene_intro',
      'scene_practice',
      'scene_summary',
    ])
    expect(buttons[1]).toHaveAttribute('aria-current', 'page')
    expect(document.activeElement).toBe(buttons[1])

    fireEvent.keyDown(buttons[1]!, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(buttons[2])
    fireEvent.keyDown(buttons[2]!, { key: 'Home' })
    expect(document.activeElement).toBe(buttons[0])
    fireEvent.keyDown(buttons[0]!, { key: 'End' })
    expect(document.activeElement).toBe(buttons[2])

    fireEvent.click(buttons[2]!)
    expect(onSelect).toHaveBeenCalledOnce()
    expect(onSelect).toHaveBeenCalledWith('scene_summary', false)
    expect(picker.isOpen).toBe(false)
    expect(stage.querySelector('.lesson-scene-picker-layer')).not.toBeVisible()
    await Promise.resolve()
    expect(document.activeElement).toBe(restoreTarget)

    picker.destroy()
  })

  it('closes on outside click, Escape and destroy without selecting a scene', async () => {
    const stage = createStage()
    const onSelect = vi.fn()
    const onClose = vi.fn()
    const picker = new ScenePickerOverlay({ stage, scenes, onSelect, onClose })
    const layer = stage.querySelector<HTMLDivElement>(
      '.lesson-scene-picker-layer',
    )!

    picker.open('scene_intro')
    await Promise.resolve()
    fireEvent.click(layer)
    expect(picker.isOpen).toBe(false)

    picker.open('scene_intro')
    await Promise.resolve()
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(picker.isOpen).toBe(false)
    expect(onClose).toHaveBeenCalledTimes(2)
    expect(onSelect).not.toHaveBeenCalled()

    picker.open('scene_intro')
    picker.destroy()
    expect(stage.querySelector('.lesson-scene-picker-layer')).toBeNull()
    expect(onClose).toHaveBeenCalledTimes(3)
  })

  it('binds guard bypass to one open session and clears it on close', async () => {
    const stage = createStage()
    const onSelect = vi.fn()
    const picker = new ScenePickerOverlay({ stage, scenes, onSelect })

    picker.open('scene_intro', { bypassNavigationGuards: true })
    picker.close()
    picker.open('scene_intro')
    await Promise.resolve()
    fireEvent.click(stage.querySelector<HTMLButtonElement>(
      '[data-scene-id="scene_summary"]',
    )!)
    expect(onSelect).toHaveBeenLastCalledWith('scene_summary', false)

    picker.open('scene_intro', { bypassNavigationGuards: true })
    await Promise.resolve()
    fireEvent.click(stage.querySelector<HTMLButtonElement>(
      '[data-scene-id="scene_practice"]',
    )!)
    expect(onSelect).toHaveBeenLastCalledWith('scene_practice', true)
    picker.destroy()
  })
})


describe('ScenePickerOverlay scene and step hierarchy', () => {
  const nested = [
    { id: 'scene-a', name: '演示页', steps: [{ id: 'state-1', name: '先观察' }, { id: 'state-2', name: '再解释' }] },
    { id: 'scene-b', name: '无限画布', steps: [{ id: 'camera-1', name: '全景' }, { id: 'camera-2', name: '局部' }] },
    { id: 'scene-c', name: '总结' },
  ]

  it('focuses the exact current step and selects a step without interpreting it as a scene', async () => {
    const stage = createStage()
    const restore = document.createElement('button')
    document.body.prepend(restore)
    restore.focus()
    const onSelect = vi.fn()
    const picker = new ScenePickerOverlay({ stage, scenes: nested, onSelect })
    picker.open('scene-b', { currentStepId: 'camera-2', bypassNavigationGuards: true })
    await Promise.resolve()
    const current = stage.querySelector<HTMLButtonElement>('[data-step-id="camera-2"]')!
    expect(stage.querySelector('[data-scene-id="scene-b"]')).toHaveAttribute('aria-current', 'page')
    expect(current).toHaveAttribute('aria-current', 'step')
    expect(current).toHaveTextContent('步骤 2 · 局部')
    expect(document.activeElement).toBe(current)
    expect(stage.querySelector('[data-scene-steps="scene-a"]')).not.toBeVisible()
    expect(stage.querySelector('[data-scene-steps="scene-b"]')).toBeVisible()
    expect(stage.querySelector('[data-scene-steps-toggle="scene-b"]')).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(current)
    expect(onSelect).toHaveBeenCalledWith('camera-2', true)
    await Promise.resolve()
    expect(document.activeElement).toBe(restore)
    picker.open('scene-b', { currentStepId: 'camera-1' })
    await Promise.resolve()
    fireEvent.click(stage.querySelector('[data-scene-id="scene-a"]')!)
    expect(onSelect).toHaveBeenLastCalledWith('scene-a', false)
    picker.destroy()
  })

  it('keeps hidden steps out of keyboard traversal and traps focus after expansion', async () => {
    const stage = createStage()
    const picker = new ScenePickerOverlay({ stage, scenes: nested, onSelect: vi.fn() })
    picker.open('scene-a', { currentStepId: 'state-2' })
    await Promise.resolve()
    const toggle = stage.querySelector<HTMLButtonElement>('[data-scene-steps-toggle="scene-a"]')!
    fireEvent.click(toggle)
    expect(document.activeElement).toBe(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    fireEvent.keyDown(toggle, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(stage.querySelector('[data-scene-id="scene-b"]'))
    fireEvent.keyDown(document.activeElement!, { key: 'End' })
    expect(document.activeElement).toBe(stage.querySelector('[data-scene-id="scene-c"]'))
    fireEvent.keyDown(document.activeElement!, { key: 'Tab' })
    const close = stage.querySelector<HTMLButtonElement>('.lesson-scene-picker__close')!
    expect(document.activeElement).toBe(close)
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(stage.querySelector('[data-scene-id="scene-c"]'))
    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    toggle.focus()
    fireEvent.keyDown(toggle, { key: 'ArrowDown' })
    expect(document.activeElement).toBe(stage.querySelector('[data-step-id="state-1"]'))
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(picker.isOpen).toBe(false)
    picker.destroy()
  })
})
