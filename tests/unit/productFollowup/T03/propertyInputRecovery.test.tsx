import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { BufferedInput, PropertyDraftBoundary, discardPropertiesDrafts, flushPropertiesDrafts,
  hasPropertiesDrafts, preservePropertiesDrafts, restorePropertiesDrafts } from '../../../../src/renderer/ui/properties/PropertyControls'

const binding = (epoch = 'epoch-one') => JSON.stringify(['teacher-doc', epoch, 'slide', null, ['shape'], false])
afterEach(() => { cleanup(); discardPropertiesDrafts('teacher-doc') })

it('same X value on another object displays its own numeric input while incomplete original raw stays bound to the first object', async () => {
  const a = JSON.stringify(['teacher-doc', 'epoch-one', 'slide', null, ['object-a'], false])
  const b = JSON.stringify(['teacher-doc', 'epoch-one', 'slide', null, ['object-b'], false])
  const commitA = vi.fn(), commitB = vi.fn()
  const view = (key: string, commit: (value: string) => void, value = 250) => <PropertyDraftBoundary bindingKey={key} onStale={() => {}}>
    <BufferedInput label="X" value={value} type="number" onCommit={commit} />
  </PropertyDraftBoundary>
  const mounted = render(view(a, commitA))
  fireEvent.focus(screen.getByLabelText('X'))
  fireEvent.change(screen.getByLabelText('X'), { target: { value: '-' } })
  mounted.rerender(view(b, commitB))
  expect(screen.getByLabelText('X')).toHaveValue('250')
  expect(preservePropertiesDrafts('teacher-doc')).toEqual([expect.objectContaining({ bindingKey: a, raw: '-', kind: 'number' })])
  expect(commitA).not.toHaveBeenCalled(); expect(commitB).not.toHaveBeenCalled()
  fireEvent.focus(screen.getByLabelText('X'))
  fireEvent.change(screen.getByLabelText('X'), { target: { value: '260' } })
  await act(async () => fireEvent.blur(screen.getByLabelText('X')))
  expect(commitB).toHaveBeenCalledExactlyOnceWith('260')
  expect(commitA).not.toHaveBeenCalled()
  mounted.rerender(view(a, commitA))
  expect(screen.getByLabelText('X')).toHaveValue('-')
  await act(async () => expect(await flushPropertiesDrafts('teacher-doc')).toBe(false))
  expect(screen.getByLabelText('X')).toHaveValue('-')
  expect(commitA).not.toHaveBeenCalled()
  expect(commitB).toHaveBeenCalledTimes(1)
})

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
  await act(async () => expect(await flushPropertiesDrafts('teacher-doc')).toBe(false))
  expect(commit).not.toHaveBeenCalled()
  fireEvent.change(screen.getByLabelText('名称'), { target: { value: '中文完成' } })
  await act(async () => expect(await flushPropertiesDrafts('teacher-doc')).toBe(true))
  expect(commit).toHaveBeenCalledExactlyOnceWith('中文完成')
  await act(async () => expect(await flushPropertiesDrafts('teacher-doc')).toBe(true))
  expect(commit).toHaveBeenCalledTimes(1)
})
