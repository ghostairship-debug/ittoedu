import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ChatComposerMenus, type ChatComposerMenusHandle } from '../../src/renderer/ui/chat/ChatComposerMenus'

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

describe('chat composer menu keyboard navigation', () => {
  const commands = () => [
    { id: 'discuss', label: '讨论', run: vi.fn() },
    { id: 'plan', label: '计划', run: vi.fn() },
    { id: 'edit', label: '编辑', run: vi.fn() },
  ]
  function mount(value: string, list = commands(), mentions: { name: string; path: string }[] = [], onChange = vi.fn()) {
    const ref = createRef<ChatComposerMenusHandle>()
    const ui = render(<ChatComposerMenus ref={ref} value={value} onChange={onChange} commands={list} mentions={mentions} />)
    return { ref, ui, list, onChange }
  }
  const press = (ref: React.RefObject<ChatComposerMenusHandle | null>, key: string, init: Partial<KeyboardEventInit> = {}) => {
    let consumed = false
    act(() => {
      // 组件通过 imperative handle 接收 composer 的按键：这里复用真实 DOM 事件以带上 isComposing。
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })
      consumed = ref.current!.handleKeyDown({
        key, keyCode: init.keyCode ?? 0, nativeEvent: event, preventDefault: () => event.preventDefault(),
      } as unknown as React.KeyboardEvent)
    })
    return consumed
  }
  const selected = () => screen.getByRole('option', { selected: true }).textContent

  it('opens on the first item and cycles with the arrow keys', () => {
    const { ref } = mount('/')
    expect(selected()).toBe('讨论')
    press(ref, 'ArrowDown')
    expect(selected()).toBe('计划')
    press(ref, 'ArrowUp')
    expect(selected()).toBe('讨论')
    // 到顶继续上行要绕回末项（VS Code 的候选列表是循环的），否则长列表回不到底部。
    press(ref, 'ArrowUp')
    expect(selected()).toBe('编辑')
    press(ref, 'ArrowDown')
    expect(selected()).toBe('讨论')
  })

  it('runs the active command on Enter and Tab, and reports the key as consumed', () => {
    const { ref, list } = mount('/')
    press(ref, 'ArrowDown')
    expect(press(ref, 'Enter')).toBe(true)
    expect(list[1]!.run).toHaveBeenCalledTimes(1)
    expect(list[0]!.run).not.toHaveBeenCalled()
    const second = mount('/')
    expect(press(second.ref, 'Tab')).toBe(true)
    expect(second.list[0]!.run).toHaveBeenCalledTimes(1)
  })

  it('inserts the active mention on Enter', () => {
    const onChange = vi.fn()
    const { ref } = mount('参考 @', [], [{ name: 'a.md', path: '/ws/a.md' }, { name: 'b.md', path: '/ws/b.md' }], onChange)
    press(ref, 'ArrowDown')
    press(ref, 'Enter')
    expect(onChange).toHaveBeenCalledWith('参考 @/ws/b.md ')
  })

  it('ignores every key while an IME composition is active', () => {
    // 组合期间的 Enter 是「选字」，不是「选中菜单项」。漏掉守卫就会在打中文时误触发命令。
    const { ref, list } = mount('/')
    expect(press(ref, 'Enter', { isComposing: true })).toBe(false)
    expect(press(ref, 'ArrowDown', { isComposing: true })).toBe(false)
    expect(press(ref, 'Enter', { keyCode: 229 })).toBe(false)
    expect(list.some(item => item.run.mock.calls.length > 0)).toBe(false)
    expect(selected()).toBe('讨论')
  })

  it('closes on Escape without clearing the input, and reopens as the query changes', () => {
    const { ref, ui, onChange } = mount('/')
    expect(press(ref, 'Escape')).toBe(true)
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(onChange).not.toHaveBeenCalled()
    expect(press(ref, 'Enter')).toBe(false)
    ui.rerender(<ChatComposerMenus ref={ref} value="/计" onChange={onChange} commands={commands()} mentions={[]} />)
    expect(screen.getByRole('option', { name: '计划' })).toBeTruthy()
  })
})
