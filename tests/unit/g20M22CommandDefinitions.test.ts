import { describe, expect, it } from 'vitest'
import { slideLightCommands, slideLightPageCommands, slideLightObjectCommands } from '../../src/renderer/editing/commands/slideLightCommands'

const state = { isText: true, locked: false, clickBindable: true, sounds: [{ id: 'sound-1', name: '提示' }], locations: [{ id: 'loc-1', label: '同名' }, { id: 'loc-2', label: '同名' }] }

describe('M22 command definitions', () => {
  it('names opacity direction and extra pixel spacing and keeps duplicate labels keyed by identity', () => {
    const commands = slideLightCommands(state)
    expect(commands.find(command => command.id === 'slide.opacity.25')?.label).toBe('不透明度：25%')
    expect(commands.find(command => command.id === 'slide.spacing.8')?.label).toContain('额外 8 像素')
    expect(commands.filter(command => command.kind === 'location-go').map(command => command.value)).toEqual(['loc-1', 'loc-2'])
    expect(new Set(commands.map(command => command.id)).size).toBe(commands.length)
    expect(commands.filter(command => command.kind === 'font').length).toBeGreaterThan(0)
  })

  it('separates page actions from object actions without requiring a selected item', () => {
    const page = slideLightPageCommands({ stateBackgroundOverride: false })
    const object = slideLightObjectCommands(state)
    expect(page.some(command => command.kind === 'scene-background')).toBe(true)
    expect(page.some(command => command.kind === 'audio-import')).toBe(true)
    expect(page.every(command => command.kind === 'scene-background' || command.kind === 'audio-import')).toBe(true)
    expect(object.some(command => command.kind === 'opacity')).toBe(true)
    expect(object.some(command => command.kind === 'location-go')).toBe(true)
    expect(object.some(command => command.kind === 'scene-background' || command.kind === 'audio-import')).toBe(false)
  })

  it('keeps unavailable entries disabled with a reason', () => {
    const commands = slideLightCommands({ ...state, isText: false, clickBindable: false, stateBackgroundOverride: true })
    expect(commands.find(command => command.kind === 'font')?.disabledReason).toContain('仅文字')
    expect(commands.find(command => command.kind === 'audio-play')?.disabledReason).toContain('点击互动')
    expect(commands.find(command => command.kind === 'scene-background')?.disabledReason).toContain('独立背景')
  })
})
