import { describe, expect, it } from 'vitest'
import { slideLightCommands, slideLightPageCommands, slideLightObjectCommands } from '../../src/renderer/editing/commands/slideLightCommands'

const state = { isText: true, locked: false, clickBindable: true, sounds: [{ id: 'sound-1', name: '提示' }], locations: [{ id: 'loc-1', label: '同名' }, { id: 'loc-2', label: '同名' }] }

describe('M22 command definitions', () => {
  it('names opacity direction and extra pixel spacing and keeps duplicate labels keyed by identity', () => {
    const commands = slideLightCommands(state)
    expect(commands.find(command => command.id === 'slide.opacity.25')?.label).toBe('不透明度：25%')
    expect(commands.find(command => command.id === 'slide.spacing.8')?.label).toContain('额外 8 像素')
    expect(commands.filter(command => command.kind === 'location-go').map(command => [command.label, command.value])).toEqual([
      ['点击跳到：同名（第1页）', 'loc-1'], ['点击跳到：同名（第2页）', 'loc-2'],
    ])
    expect(new Set(commands.map(command => command.id)).size).toBe(commands.length)
    expect(commands.filter(command => command.kind === 'font').length).toBeGreaterThan(0)
  })

  it('keeps a unique destination name concise while numbering duplicate names by course order', () => {
    const commands = slideLightObjectCommands({ ...state, locations: [
      { id: 'loc-1', label: '同名' }, { id: 'loc-flow', label: 'Flow 目标页' }, { id: 'loc-2', label: '同名' },
    ] })
    expect(commands.filter(command => command.kind === 'location-go').map(command => [command.label, command.value])).toEqual([
      ['点击跳到：同名（第1页）', 'loc-1'], ['点击跳到：Flow 目标页', 'loc-flow'], ['点击跳到：同名（第3页）', 'loc-2'],
    ])
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

  it('omits text-only entries for non-text and explains unavailable actions', () => {
    const commands = slideLightCommands({ ...state, isText: false, clickBindable: false, stateBackgroundOverride: true })
    expect(commands.some(command => command.kind === 'font')).toBe(false)
    expect(commands.find(command => command.kind === 'audio-play')?.disabledReason).toContain('点击互动')
    expect(commands.find(command => command.kind === 'scene-background')?.disabledReason).toContain('独立背景')
  })
})
