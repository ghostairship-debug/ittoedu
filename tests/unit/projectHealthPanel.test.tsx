import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { analyzeInformationRelease } from '@/shared/informationRelease'
import { analyzeVisualDensity } from '@/shared/visualDensity'
import { collectCourseProjectHealth } from '@/shared/courseProjectHealth'
import { collectProjectHealth } from '@/shared/projectHealth'
import {
  selectActiveCourseProjectDocument,
  selectMediaAssetFiles,
  useEditorStore,
} from '@/renderer/store/editorStore'
import { componentPackagesToArchiveFiles } from '@/renderer/components/componentPackageStore'
import { ProjectHealthPanel } from '@/renderer/ui/ProjectHealthPanel'

vi.mock('@/shared/informationRelease', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/informationRelease')>()
  return {
    ...actual,
    analyzeInformationRelease: vi.fn(actual.analyzeInformationRelease),
  }
})

vi.mock('@/shared/visualDensity', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/visualDensity')>()
  return {
    ...actual,
    analyzeVisualDensity: vi.fn(actual.analyzeVisualDensity),
  }
})

vi.mock('@/shared/projectHealth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/projectHealth')>()
  return {
    ...actual,
    collectProjectHealth: vi.fn(actual.collectProjectHealth),
  }
})

vi.mock('@/shared/courseProjectHealth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/shared/courseProjectHealth')>()
  return {
    ...actual,
    collectCourseProjectHealth: vi.fn(actual.collectCourseProjectHealth),
  }
})

beforeEach(() => {
  useEditorStore.getState().createNewProject()
  vi.mocked(collectProjectHealth).mockClear().mockReturnValue([])
  vi.mocked(collectCourseProjectHealth).mockClear().mockReturnValue([])
  vi.mocked(analyzeInformationRelease).mockClear()
  vi.mocked(analyzeVisualDensity).mockClear()
})

afterEach(() => cleanup())

describe('ProjectHealthPanel on-demand analysis', () => {
  it('uses the latest V9 document and archive files only after opening', () => {
    const onClose = vi.fn()
    const { rerender } = render(
      <ProjectHealthPanel open={false} onClose={onClose} />,
    )

    expect(collectProjectHealth).not.toHaveBeenCalled()
    expect(collectCourseProjectHealth).not.toHaveBeenCalled()
    expect(analyzeInformationRelease).not.toHaveBeenCalled()
    expect(analyzeVisualDensity).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: '工程检查' })).not.toBeInTheDocument()

    const staleProject = selectActiveCourseProjectDocument(useEditorStore.getState())!
    useEditorStore.getState().addTextNode()
    const latestState = useEditorStore.getState()
    expect(selectActiveCourseProjectDocument(latestState)).not.toBe(staleProject)

    rerender(<ProjectHealthPanel open onClose={onClose} />)

    const courseProject = selectActiveCourseProjectDocument(latestState)
    if (!courseProject) throw new Error('expected V9 course project')
    expect(collectCourseProjectHealth).toHaveBeenCalledTimes(1)
    expect(collectCourseProjectHealth).toHaveBeenCalledWith(courseProject, {
      assetFiles: selectMediaAssetFiles(latestState),
      componentFiles: componentPackagesToArchiveFiles(latestState.componentPackages),
    })
    expect(collectProjectHealth).not.toHaveBeenCalled()
    expect(analyzeInformationRelease).not.toHaveBeenCalled()
    expect(analyzeVisualDensity).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog', { name: '工程检查' })).toBeInTheDocument()
    expect(screen.getByLabelText('工程检查摘要')).toBeInTheDocument()
  })
})
