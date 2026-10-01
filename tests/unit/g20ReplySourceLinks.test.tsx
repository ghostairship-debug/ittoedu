import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import type { LessonDesktopResult } from '../../src/shared/lessonDesktopContract'

const host = vi.hoisted(() => ({ openExternal: vi.fn(async (_url: string) => {}) }))
vi.mock('electron', () => ({
  app: { getPath: () => 'C:/fixture-app-data' }, dialog: {},
  shell: { openExternal: (url: string) => host.openExternal(url) },
}))
vi.mock('../../src/main/fileDialogs', () => ({ openSelectedProjectFile: vi.fn() }))
vi.mock('../../src/main/workbench/workspaceFilesDesktopService', () => ({ authorizeWorkspaceFilesRoot: vi.fn() }))
import { operateLessonDesktop } from '../../src/main/lessonDesktopService'
import { ExecutionReplyContent } from '../../src/renderer/workbench/ExecutionReplyContent'

afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals() })

it('opens reply source HTTPS through the system host and returns receipts for rejected protocols and host failures', async () => {
  const window = {} as BrowserWindow
  const url = 'https://example.test/research?section=1&view=full'
  await expect(operateLessonDesktop(window, { operation: 'open-link', url })).resolves.toEqual({ opened: true })
  expect(host.openExternal).toHaveBeenCalledExactlyOnceWith(url)

  await expect(operateLessonDesktop(window, { operation: 'open-link', url: 'javascript:alert(1)' }))
    .resolves.toEqual({ opened: false, openError: '仅支持打开网页链接。' })
  expect(host.openExternal).toHaveBeenCalledTimes(1)

  host.openExternal.mockRejectedValueOnce(new Error('No browser association'))
  await expect(operateLessonDesktop(window, { operation: 'open-link', url }))
    .resolves.toEqual({ opened: false, openError: '浏览器未能打开该链接，请复制链接后重试。' })
  expect(host.openExternal).toHaveBeenCalledTimes(2)
})

it('requests a reply source only on a manual click and keeps failed links and non-web addresses readable without loading images or scripts', async () => {
  const url = 'https://example.test/research?section=1&view=full'
  const lesson = vi.fn(async (): Promise<LessonDesktopResult> => ({ opened: false, openError: '浏览器未能打开该链接，请复制链接后重试。' }))
  vi.stubGlobal('desktopAPI', { lesson })
  const { container } = render(<ExecutionReplyContent text={`[论文 **原文**](${url})

[邮件地址](mailto:teacher@example.test)

![示意图](https://example.test/diagram.png)

<script>window.replySourceScriptExecuted=true</script>`} />)
  const link = screen.getByRole('link', { name: '论文 原文' })
  expect(screen.getAllByRole('link')).toHaveLength(1)
  expect(link).toHaveAttribute('href', url)
  expect(link).toHaveAttribute('title', url)
  expect(container).toHaveTextContent('邮件地址（mailto:teacher@example.test）')
  expect(container).toHaveTextContent('示意图（https://example.test/diagram.png）')
  expect(container.querySelectorAll('img,script,iframe')).toHaveLength(0)
  expect((window as unknown as { replySourceScriptExecuted?: boolean }).replySourceScriptExecuted).toBeUndefined()
  expect(lesson).not.toHaveBeenCalled()
  expect(host.openExternal).not.toHaveBeenCalled()

  const click = new MouseEvent('click', { bubbles: true, cancelable: true })
  fireEvent(link, click)
  expect(click.defaultPrevented).toBe(true)
  expect(lesson).toHaveBeenCalledExactlyOnceWith({ operation: 'open-link', url })
  expect(await screen.findByRole('alert')).toHaveTextContent('浏览器未能打开该链接，请复制链接后重试。')
  expect(link).toHaveAttribute('href', url)
  expect(container).toHaveTextContent(url)
})
