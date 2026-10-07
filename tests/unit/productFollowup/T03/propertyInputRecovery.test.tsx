import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { BufferedInput, PropertyDraftBoundary, discardPropertiesDrafts, flushPropertiesDrafts,
  hasPropertiesDrafts, preservePropertiesDrafts, restorePropertiesDrafts } from '../../../../src/renderer/ui/properties/PropertyControls'

const binding = (epoch = 'epoch-one') => JSON.stringify(['teacher-doc', epoch, 'slide', null, ['shape'], false])
afterEach(() => { cleanup(); discardPropertiesDrafts('teacher-doc') })

it.each(['-', ''])('incomplete numeric %j stays raw across recovery before mounting and never writes zero', async raw => {
  const commit = vi.fn()
  const view = (epoch = 'epoch-one') => <PropertyDraftBoundary bindingKey={binding(epoch)} onStale={() => {}}>
    <BufferedInput label="X" value={35} type="number" onCommit={commit} />
  </PropertyDraftBoundary>
  const initial = render(view())
  fireEvent.focus(screen.getByLabelText('X'))
  fireEvent.change(screen.getByLabelText('X'), { target: { value: raw } })
  await act(async () => expect(await flushPropertiesDrafts('teacher-doc')).toBe(false))
  expect(screen.getByLabelText('X')).toHaveValue(raw)
  const persisted = JSON.parse(JSON.stringify(preservePropertiesDrafts('teacher-doc')))
  expect(persisted).toEqual([expect.objectContaining({ raw, kind: 'number' })])
  initial.unmount(); discardPropertiesDrafts('teacher-doc')
  restorePropertiesDrafts('teacher-doc', persisted)
  render(view('epoch-two'))
  expect(screen.getByLabelText('X')).toHaveValue(raw)
  expect(hasPropertiesDrafts('teacher-doc')).toBe(true)
  expect(commit).not.toHaveBeenCalled()
  await act(async () => expect(await flushPropertiesDrafts('teacher-doc')).toBe(false))
  fireEvent.change(screen.getByLabelText('X'), { target: { value: '85' } })
  await act(async () => expect(await flushPropertiesDrafts('teacher-doc')).toBe(true))
  expect(commit).toHaveBeenCalledExactlyOnceWith('85')
})

it('restores IME text into an already mounted control without replaying a command and saves the corrected value once', async () => {
  const commit = vi.fn()
  const view = (epoch: string) => <PropertyDraftBoundary bindingKey={binding(epoch)} onStale={() => {}}>
    <BufferedInput label="名称" value="原名" onCommit={commit} />
  </PropertyDraftBoundary>
  const first = render(view('epoch-one'))
  fireEvent.compositionStart(screen.getByLabelText('名称'))
  fireEvent.change(screen.getByLabelText('名称'), { target: { value: '中文未完' } })
  await act(async () => expect(await flushPropertiesDrafts('teacher-doc')).toBe(false))
  const persisted = JSON.parse(JSON.stringify(preservePropertiesDrafts('teacher-doc')))
  first.unmount(); discardPropertiesDrafts('teacher-doc')
  render(view('epoch-two'))
  await act(async () => restorePropertiesDrafts('teacher-doc', persisted))
  expect(screen.getByLabelText('名称')).toHaveValue('中文未完')
  expect(commit).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('名称'), { target: { value: '中文完成' } })
  await act(async () => expect(await flushPropertiesDrafts('teacher-doc')).toBe(true))
  expect(commit).toHaveBeenCalledExactlyOnceWith('中文完成')
  await act(async () => expect(await flushPropertiesDrafts('teacher-doc')).toBe(true))
  expect(commit).toHaveBeenCalledTimes(1)
})
