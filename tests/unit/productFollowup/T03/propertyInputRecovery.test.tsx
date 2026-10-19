import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DocumentHostService } from '../../../../src/main/workbench/DocumentHostService'
import { documentHostAPI } from '../../../helpers/documentHostAPI'
import { createBlankCourseProjectV10 } from '../../../../src/core/course/createCourseProjectV10'
import { CourseV10DocumentBridge } from '../../../../src/renderer/documents/CourseV10DocumentBridge'
import { createCourseInputLifecycle } from '../../../../src/renderer/authoring/courseDraftLifecycle'
import { BufferedInput, PropertyDraftBoundary, discardPropertiesDrafts, flushPropertiesDrafts,
  hasPropertiesDrafts, preservePropertiesDrafts, restorePropertiesDrafts } from '../../../../src/renderer/ui/properties/PropertyControls'

const binding = (epoch = 'epoch-one') => JSON.stringify(['teacher-doc', epoch, 'slide', null, ['shape'], false])
afterEach(() => { cleanup(); discardPropertiesDrafts('teacher-doc') })

it('does not silently choose between different raw inputs for one restored property target', () => {
  const record = { bindingKey: binding(), label: 'X', kind: 'number' as const, raw: '-', baseline: '35', composing: false }
  expect(restorePropertiesDrafts('teacher-doc', [record, { ...record, raw: 'different raw' }], 'epoch-two'))
    .toEqual({ adopted: [], ambiguous: true })
  expect(preservePropertiesDrafts('teacher-doc')).toEqual([])
  expect(restorePropertiesDrafts('teacher-doc', [record], 'epoch-two')).toEqual({ adopted: [record], ambiguous: false })
  expect(preservePropertiesDrafts('teacher-doc')).toEqual([{ ...record, bindingKey: binding('epoch-two') }])
})

it('claims only input actually retained when a mounted property already has a different draft', () => {
  const commit = vi.fn()
  render(<PropertyDraftBoundary bindingKey={binding('epoch-two')} onStale={() => {}}>
    <BufferedInput label="X" value={35} type="number" onCommit={commit} />
  </PropertyDraftBoundary>)
  fireEvent.focus(screen.getByLabelText('X'))
  fireEvent.change(screen.getByLabelText('X'), { target: { value: '-' } })
  const record = { bindingKey: binding(), label: 'X', kind: 'number' as const, raw: '90', baseline: '35', composing: false }
  expect(restorePropertiesDrafts('teacher-doc', [record], 'epoch-two')).toEqual({ adopted: [], ambiguous: true })
  expect(screen.getByLabelText('X')).toHaveValue('-')
  expect(commit).not.toHaveBeenCalled()
})

it('keeps a rejected same-epoch property original in the real Host when a remounted control persists newer input', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'property-same-epoch-')), bridge = new CourseV10DocumentBridge()
  const host = new DocumentHostService(path.join(root, 'recovery'))
  const snapshot = await host.internalAPI.create({ kind: 'course-v10', project: createBlankCourseProjectV10(), resources: { assets: {}, components: {} } }, 'properties.glx')
  const api = documentHostAPI(host), key = JSON.stringify([snapshot.documentId, snapshot.epoch, 'slide', null, ['shape'], false])
  try {
    await bridge.connect(api)
    const original = { bindingKey: key, label: 'X', kind: 'number' as const, raw: '90', baseline: '35', composing: false }
    await api.writeAuthoringDrafts(snapshot.documentId, { properties: [original] }, snapshot.epoch)
    const old = (await api.readAuthoringDrafts(snapshot.documentId))!.recoveryRecords![0]!
    render(<PropertyDraftBoundary bindingKey={key} onStale={() => {}}>
      <BufferedInput label="X" value={35} type="number" onCommit={() => {}} />
    </PropertyDraftBoundary>)
    fireEvent.focus(screen.getByLabelText('X'))
    fireEvent.change(screen.getByLabelText('X'), { target: { value: '-' } })
    const lifecycle = createCourseInputLifecycle(bridge, {
      capture: () => ({ snapshot: bridge.read().documents[0]!, records: { advanced: [], properties: preservePropertiesDrafts(snapshot.documentId) }, flowDraft: null }),
      restore: (documentId, epoch, records) => ({ advanced: [], properties: restorePropertiesDrafts(documentId, records.properties, epoch).adopted }),
      drain: async () => {}, suspend: () => {}, resume: () => {}, error: () => {}, status: () => {},
    })
    lifecycle.connect(api)
    await lifecycle.restore(snapshot.documentId)
    await lifecycle.persist([snapshot.documentId])
    const retained = await api.readAuthoringDrafts(snapshot.documentId)
    expect(retained!.properties.map(record => record.raw)).toEqual(expect.arrayContaining(['90', '-']))
    expect(retained!.recoveryRecords!.some(record => record.id === old.id && record.digest === old.digest)).toBe(true)
    expect(screen.getByLabelText('X')).toHaveValue('-')
  } finally {
    cleanup(); discardPropertiesDrafts(snapshot.documentId); bridge.dispose()
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('unexpected fixture path')
    await fs.rm(root, { recursive: true, force: true })
  }
})

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
