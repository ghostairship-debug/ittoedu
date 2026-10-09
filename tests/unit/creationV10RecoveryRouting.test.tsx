import { useSyncExternalStore } from 'react'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { CourseV10DocumentBridge } from '../../src/renderer/documents/CourseV10DocumentBridge'
import type { RecoverableDocumentFilePort } from '../../src/renderer/documentFiles/documentFileSession'
import { useDocumentTabsController, type DocumentTabsController } from '../../src/renderer/lessonWorkspace/controller/useDocumentTabsController'
import { WorkspaceRecoveryPanel } from '../../src/renderer/workbench/WorkspaceRecoveryPanel'
import { createMarkdownTestHost } from '../helpers/markdownDocumentHost'

it('opens a durable V10 recovery in the course bridge and preserves its saved file and undo history', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'creation-v10-recovery-'))
  const bridge = new CourseV10DocumentBridge()
  try {
    const journal = path.join(directory, 'journal')
    const original = createMarkdownTestHost(journal)
    const project = createBlankCourseProjectV10('磁盘原稿')
    const draft = await original.documents.create({ kind: 'course-v10', project,
      resources: { assets: {}, components: {} } }, '恢复课件.glx')
    const filename = path.join(directory, '恢复课件.glx')
    const saved = await original.documents.save(draft.documentId, filename)
    expect(saved).toMatchObject({ revision: 0, dirty: false })
    expect(await original.documents.dispatch({ documentId: saved.documentId, epoch: saved.epoch,
      baseRevision: saved.revision, operationId: 'unsaved-v10-title', actor: 'human',
      mutation: { type: 'command', command: captureComponentOperation(project, [
        { type: 'project.title.set', title: '恢复后的正式内容' },
      ]) },
    })).toMatchObject({ status: 'applied', revision: 1 })

    const restarted = createMarkdownTestHost(journal)
    restarted.documents.bootstrapCourse = () => restarted.host.bootstrapCourse()
    const restore = vi.spyOn(restarted.documents, 'restore')
    const save = vi.spyOn(restarted.documents, 'save')
    await bridge.connect(restarted.documents)
    const activate = vi.fn((documentId: string) => bridge.activate(documentId))
    const unavailable = async (): Promise<never> => { throw new Error('The course must not enter the legacy document file editor') }
    const port: RecoverableDocumentFilePort = { documents: restarted.documents,
      openDocument: unavailable, saveDocument: unavailable, watchDocument: () => () => {} }
    let tabs!: DocumentTabsController
    function RecoveryWorkspace() {
      const course = useSyncExternalStore(bridge.subscribe, bridge.read)
      tabs = useDocumentTabsController({ documentPort: port, courseDocuments: {
        documents: course.documents, activeDocumentId: course.activeDocumentId, activation: course.activation,
        activate, close: documentId => bridge.close(documentId),
      } })
      return <WorkspaceRecoveryPanel api={restarted.documents} onRestored={tabs.focusDocument} />
    }
    render(<RecoveryWorkspace />)
    fireEvent.click(await screen.findByRole('button', { name: '恢复稿（1）' }))
    const row = (await screen.findByText('恢复课件.glx')).closest('li')!
    expect(within(row).getByText('果铃工程 · 尚未恢复')).toBeTruthy()
    fireEvent.click(within(row).getByRole('button', { name: '恢复并打开' }))
    await waitFor(() => {
      expect(tabs.activeTab).toBe(draft.documentId)
      expect(tabs.isCourseActive).toBe(true)
    })
    expect(restore).toHaveBeenCalledExactlyOnceWith(draft.documentId)
    expect(activate).toHaveBeenCalledExactlyOnceWith(draft.documentId)
    expect(tabs.tabs.filter(tab => tab.documentId === draft.documentId)).toEqual([
      expect.objectContaining({ kind: 'course', path: filename, dirty: true }),
    ])
    expect(tabs.tabs.some(tab => tab.kind === 'document')).toBe(false)
    expect(bridge.read().snapshot).toMatchObject({ documentId: draft.documentId,
      revision: 1, undoDepth: 1, dirty: true,
      model: { kind: 'course-v10', project: { title: '恢复后的正式内容' } },
    })
    await act(async () => { await bridge.undo(draft.documentId) })
    expect(bridge.read().project?.title).toBe('磁盘原稿')
    expect(save).not.toHaveBeenCalled()
    const disk = new CourseV10Driver().load(new Uint8Array(await readFile(filename)))
    expect(disk).toMatchObject({ kind: 'course-v10', project: { title: '磁盘原稿' } })
  } finally {
    cleanup()
    bridge.dispose()
    vi.restoreAllMocks()
    await rm(directory, { recursive: true, force: true })
  }
})
