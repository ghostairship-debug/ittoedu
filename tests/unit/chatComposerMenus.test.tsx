import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatComposerMenus } from '../../src/renderer/ui/chat/ChatComposerMenus'

afterEach(cleanup)

describe('chat composer / and @ menus', () => {
  it('lists wired slash commands and does not treat ordinary paths as commands', () => {
    const run = vi.fn()
    const ui = render(<ChatComposerMenus value="/讨" onChange={vi.fn()} commands={[{ id: 'discuss', label: '讨论', run }]} mentions={[]} />)
    fireEvent.mouseDown(screen.getByRole('option', { name: '讨论' }))
    expect(run).toHaveBeenCalledTimes(1)
    ui.rerender(<ChatComposerMenus value="C:/notes.md" onChange={vi.fn()} commands={[{ id: 'discuss', label: '讨论', run }]} mentions={[]} />)
    expect(screen.queryByRole('listbox', { name: '命令菜单' })).toBeNull()
  })

  it('keeps POSIX absolute paths out of the command menu', () => {
    // 空格后的绝对路径与整条绝对路径都不是命令：命令只在输入开头、且 token 内不含 / 时成立。
    // 否则「参考 /workspace/a.md」会被判成命令查询，弹出「没有匹配的命令」挡住正常输入。
    const commands = [{ id: 'discuss', label: '讨论', run: vi.fn() }]
    const ui = render(<ChatComposerMenus value="参考 /workspace/a.md" onChange={vi.fn()} commands={commands} mentions={[]} />)
    expect(screen.queryByRole('listbox', { name: '命令菜单' })).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    ui.rerender(<ChatComposerMenus value="/workspace/a.md" onChange={vi.fn()} commands={commands} mentions={[]} />)
    expect(screen.queryByRole('listbox', { name: '命令菜单' })).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
    ui.rerender(<ChatComposerMenus value="/" onChange={vi.fn()} commands={commands} mentions={[]} />)
    expect(screen.getByRole('option', { name: '讨论' })).toBeTruthy()
  })

  it('inserts an @ mention path without making it the edit target', () => {
    const onChange = vi.fn()
    render(<ChatComposerMenus value="参考 @" onChange={onChange} commands={[]} mentions={[{ name: '教材.pdf', path: '/ws/教材.pdf' }]} />)
    fireEvent.mouseDown(screen.getByRole('option', { name: '教材.pdf' }))
    expect(onChange).toHaveBeenCalledWith('参考 @/ws/教材.pdf ')
  })
})
