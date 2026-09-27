// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const view = {
  source: `CoursewareRuntime.define({ runtimeApiVersion: 2, create(ctx) {
    const title = '听力练习'
    const states = ['第一题 请听录音', 'Well done!']
    const id = 'score-label'
    return { destroy() {} }
  } })`,
  overrides: [{ original: '听力练习', region: 'main>h2', text: '听力训练' }, { original: 'Well done!', text: 'Great job!' }],
  locked: false,
}
const setPageText = vi.fn(async (): Promise<{ ok: true; changed: boolean } | { ok: false; reason: string }> => ({ ok: true, changed: true }))
vi.mock('../../src/renderer/composition/runtime/runtimeLightEditCommands', () => ({
  useRuntimeLightEditView: () => view,
  runtimeLightEditCommands: { setPageText: (...args: unknown[]) => setPageText(...(args as [])) },
}))
const { RuntimePageTextList } = await import('../../src/renderer/workbench/RuntimePageText')

beforeEach(() => { setPageText.mockResolvedValue({ ok: true, changed: true }) })
afterEach(() => { cleanup(); setPageText.mockReset() })

it('M15 lists page copy from the Runtime source, including text of other states, without identifiers', () => {
  render(<RuntimePageTextList itemId="runtime-1" onError={() => {}} />)
  const fields = screen.getAllByRole('textbox').map(field => field.getAttribute('aria-label'))
  expect(fields).toEqual(['页面文字：听力练习', '页面文字：第一题 请听录音', '页面文字：Well done!'])
  // An everywhere rule shows its replacement; a region rule is only noted.
  expect(screen.getByRole('textbox', { name: '页面文字：Well done!' })).toHaveValue('Great job!')
  expect(screen.getByRole('textbox', { name: '页面文字：听力练习' })).toHaveValue('听力练习')
  expect(screen.getByText('画面中已单独改为：听力训练')).toBeTruthy()
})

it('M15 writes one everywhere rule on Enter and nothing when the text is unchanged or cancelled', async () => {
  render(<RuntimePageTextList itemId="runtime-1" onError={() => {}} />)
  const field = screen.getByRole('textbox', { name: '页面文字：第一题 请听录音' })
  fireEvent.change(field, { target: { value: '第一题：请听录音' } })
  fireEvent.keyDown(field, { key: 'Enter' })
  expect(setPageText).toHaveBeenCalledExactlyOnceWith('runtime-1', '第一题 请听录音', '第一题：请听录音')
  await act(async () => { await Promise.resolve() })

  fireEvent.change(field, { target: { value: '不会提交' } })
  fireEvent.keyDown(field, { key: 'Escape' })
  fireEvent.blur(field)
  expect(setPageText).toHaveBeenCalledTimes(1)
})

it('keeps the draft until the precommit ACK and retains it when capture fails', async () => {
  let resolve!: (result: { ok: false; reason: string }) => void
  setPageText.mockImplementationOnce(() => new Promise(result => { resolve = result }))
  const onError = vi.fn()
  render(<RuntimePageTextList itemId="runtime-1" onError={onError} />)
  const field = screen.getByRole('textbox', { name: '页面文字：第一题 请听录音' })
  fireEvent.change(field, { target: { value: '待确认的文字' } })
  fireEvent.keyDown(field, { key: 'Enter' })
  expect(field).toHaveValue('待确认的文字')
  expect(field).toBeDisabled()
  fireEvent.blur(field)
  expect(setPageText).toHaveBeenCalledTimes(1)
  await act(async () => resolve({ ok: false, reason: '静态后备捕获失败，零工程写入' }))
  await waitFor(() => expect(field).not.toBeDisabled())
  expect(field).toHaveValue('待确认的文字')
  expect(onError).toHaveBeenCalledWith('静态后备捕获失败，零工程写入')
})
