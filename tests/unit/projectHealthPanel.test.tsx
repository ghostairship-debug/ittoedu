import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { analyzeInformationRelease } from '@/shared/informationRelease'
import { analyzeVisualDensity } from '@/shared/visualDensity'
import { collectProjectHealth } from '@/shared/projectHealth'
import { useEditorStore } from '@/renderer/store/editorStore'
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

beforeEach(() => {
  useEditorStore.getState().createNewProject()
  vi.mocked(collectProjectHealth).mockClear().mockReturnValue([])
  vi.mocked(analyzeInformationRelease).mockClear()
  vi.mocked(analyzeVisualDensity).mockClear()
})

afterEach(() => cleanup())

describe('ProjectHealthPanel on-demand analysis', () => {
  it('runs no panel analysis while closed and analyzes the latest state when opened', () => {
    const onClose = vi.fn()
    const { rerender } = render(
      <ProjectHealthPanel open={false} onClose={onClose} />,
    )

    expect(collectProjectHealth).not.toHaveBeenCalled()
    expect(analyzeInformationRelease).not.toHaveBeenCalled()
    expect(analyzeVisualDensity).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog', { name: '工程检查' })).not.toBeInTheDocument()

    const staleProject = useEditorStore.getState().project
    useEditorStore.getState().addTextNode()
    const latestState = useEditorStore.getState()
    expect(latestState.project).not.toBe(staleProject)

    rerender(<ProjectHealthPanel open onClose={onClose} />)

    expect(collectProjectHealth).toHaveBeenCalledTimes(1)
    expect(collectProjectHealth).toHaveBeenCalledWith(
      latestState.project,
      latestState.componentPackages,
    )
    expect(analyzeInformationRelease).toHaveBeenCalledTimes(1)
    expect(analyzeInformationRelease).toHaveBeenCalledWith(latestState.project)
    expect(analyzeVisualDensity).toHaveBeenCalledTimes(1)
    expect(analyzeVisualDensity).toHaveBeenCalledWith(latestState.project)
    expect(screen.getByRole('dialog', { name: '工程检查' })).toBeInTheDocument()
    expect(screen.getByLabelText('工程检查摘要')).toBeInTheDocument()
  })
})
