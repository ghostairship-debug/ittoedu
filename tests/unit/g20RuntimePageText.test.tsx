// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'

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
const setPageText = vi.fn(() => ({ ok: true as const, changed: true }))
vi.mock('../../src/renderer/composition/runtime/runtimeLightEditCommands', () => ({
  useRuntimeLightEditView: () => view,
  runtimeLightEditCommands: { setPageText: (...args: unknown[]) => setPageText(...(args as [])) },
}))
const { RuntimePageTextList } = await import('../../src/renderer/workbench/RuntimePageText')

afterEach(() => { cleanup(); setPageText.mockClear() })

it('M15 lists page copy from the Runtime source, including text of other states, without identifiers', () => {
  render(<RuntimePageTextList itemId="runtime-1" onError={() => {}} />)
  const fields = screen.getAllByRole('textbox').map(field => field.getAttribute('aria-label'))
  expect(fields).toEqual(['页面文字：听力练习', '页面文字：第一题 请听录音', '页面文字：Well done!'])
  // An everywhere rule shows its replacement; a region rule is only noted.
  expect(screen.getByRole('textbox', { name: '页面文字：Well done!' })).toHaveValue('Great job!')
  expect(screen.getByRole('textbox', { name: '页面文字：听力练习' })).toHaveValue('听力练习')
  expect(screen.getByText('画面中已单独改为：听力训练')).toBeTruthy()
})

it('M15 writes one everywhere rule on Enter and nothing when the text is unchanged or cancelled', () => {
  render(<RuntimePageTextList itemId="runtime-1" onError={() => {}} />)
  const field = screen.getByRole('textbox', { name: '页面文字：第一题 请听录音' })
  fireEvent.change(field, { target: { value: '第一题：请听录音' } })
  fireEvent.keyDown(field, { key: 'Enter' })
  expect(setPageText).toHaveBeenCalledExactlyOnceWith('runtime-1', '第一题 请听录音', '第一题：请听录音')

  fireEvent.change(field, { target: { value: '不会提交' } })
  fireEvent.keyDown(field, { key: 'Escape' })
  fireEvent.blur(field)
  expect(setPageText).toHaveBeenCalledTimes(1)
})
