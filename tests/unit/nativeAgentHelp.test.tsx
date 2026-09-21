import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { NativeAgentHelp } from '../../src/renderer/ui/chat/NativeAgentHelp'

const guide = `# 用户指南

从[数据边界](#数据边界)开始，也可查看[不存在的章节](#不存在的章节)。

## 数据边界

只清理应用记录。
`

afterEach(cleanup)

describe('NativeAgentHelp', () => {
  it('renders the shipped guide without a parsing error', async () => {
    const user = userEvent.setup()
    render(<NativeAgentHelp />)
    await user.click(screen.getByText('使用指南'))
    expect(await screen.findByRole('heading', { name: '用户指南' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: '4. 启动聊天、设置 CLI 与诊断' })).toBeInTheDocument()
  })

  it('keeps the native summary keyboard reachable and only renders after expansion', async () => {
    const user = userEvent.setup()
    render(<NativeAgentHelp source={guide} />)

    expect(screen.queryByRole('heading', { name: '用户指南' })).not.toBeInTheDocument()
    await user.tab()
    const summary = screen.getByText('使用指南')
    expect(summary).toHaveFocus()
    expect(summary.tagName).toBe('SUMMARY')
    await user.click(summary)

    expect(await screen.findByRole('heading', { name: '用户指南' })).toBeInTheDocument()
    expect(screen.getByText('只清理应用记录。')).toBeInTheDocument()
  })

  it('keeps valid guide-section links keyboard reachable and tied to a rendered heading', async () => {
    const user = userEvent.setup()
    render(<NativeAgentHelp source={guide} />)
    await user.click(screen.getByText('使用指南'))

    const link = screen.getByRole('link', { name: '数据边界' })
    const heading = screen.getByRole('heading', { name: '数据边界' })
    expect(link).toHaveAttribute('href', '#数据边界')
    expect(heading).toHaveAttribute('id', '数据边界')
    link.focus()
    expect(link).toHaveFocus()
  })

  it('renders a missing guide-section target as disabled text instead of a broken link', async () => {
    const user = userEvent.setup()
    render(<NativeAgentHelp source={guide} />)
    await user.click(screen.getByText('使用指南'))

    const disabled = screen.getByText('不存在的章节').closest('[aria-disabled="true"]')
    expect(disabled).toHaveAttribute('title', '本指南中没有对应章节')
    expect(screen.queryByRole('link', { name: '不存在的章节' })).not.toBeInTheDocument()
  })
})
