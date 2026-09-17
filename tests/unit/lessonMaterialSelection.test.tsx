import { useState } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { LessonMaterialBrowser } from '@/renderer/lessonMaterials/LessonMaterialBrowser'
import type { LessonMaterialRecord } from '@/shared/materialExtraction'

vi.mock('@/renderer/project/materialExtraction', () => ({ extractMaterial: vi.fn() }))
afterEach(cleanup)

it('adopts only selected fragments while viewing unrelated material leaves the selection intact', async () => {
  const record: LessonMaterialRecord = {
    version: 1, id: 'material', lessonId: 'lesson', title: '教材与附录', createdAt: 0,
    sourceVersion: 'source', extractionVersion: 'extracted', sourcePath: 'materials/source.pdf',
    format: 'pdf', extractorVersion: 'current', assets: [],
    fragments: [
      { id: 'lesson-page', kind: 'text', locator: { part: 'document.pdf', page: 1 }, text: '本课闭合路径' },
      { id: 'appendix-page', kind: 'text', locator: { part: 'document.pdf', page: 2 }, text: '无关附录' },
    ], gaps: [{ locator: { part: 'document.pdf', page: 2 }, reason: '附录缺图' }],
  }
  const select = vi.fn(), read = vi.fn(async (input: { fragmentIds: string[] }) => ({
    materialId: record.id, sourceVersion: record.sourceVersion, extractionVersion: record.extractionVersion,
    readAt: 1, fragments: record.fragments.filter(fragment => input.fragmentIds.includes(fragment.id)), assets: [],
  }))
  function Harness() {
    const [fragmentIds, setFragmentIds] = useState<string[]>([])
    return <LessonMaterialBrowser targetKey="lesson" selections={[{ id: record.id, fragmentIds }]}
      onSelect={(selectedRecord, selectedFragments) => { select(selectedRecord, selectedFragments); setFragmentIds(selectedFragments) }}
      selectSource={async () => ({ sources: [], failures: [] })} list={async () => [record]} importMaterial={async () => record} read={read} />
  }
  render(<Harness />)
  fireEvent.click(await screen.findByRole('checkbox', { name: '采用片段 1' }))
  expect(select).toHaveBeenLastCalledWith(record, ['lesson-page'])
  expect((screen.getByRole('checkbox', { name: '用于本课例创作（整份材料）' }) as HTMLInputElement).indeterminate).toBe(true)
  fireEvent.click(screen.getByRole('button', { name: '第 2 页 · 正文：无关附录' }))
  await waitFor(() => expect(read).toHaveBeenCalledWith({ id: record.id, extractionVersion: record.extractionVersion, fragmentIds: ['appendix-page'] }))
  expect(select).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('checkbox', { name: '用于本课例创作（整份材料）' }))
  expect(select).toHaveBeenLastCalledWith(record, ['lesson-page', 'appendix-page'])
  fireEvent.click(screen.getByRole('checkbox', { name: '采用片段 2' }))
  expect(select).toHaveBeenLastCalledWith(record, ['lesson-page'])
})
