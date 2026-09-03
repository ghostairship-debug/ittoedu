import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { insertFlowEditorBlock, updateFlowEditorBlock } from '@/renderer/course/flowEditorCommands'
import { findFlowBlockRecursive, flowSurfaceIn } from '@/renderer/course/flowDocumentModel'
import {
  locateCourseLayer,
  makeEffectiveLayerAuthoringAddress,
  patchEffectiveLayerPropertiesAtTargets,
} from '@/renderer/course/effectiveLayerCommands'
import { readFlowSharedOwnership } from '@/renderer/course/flowSharedAuthoringAdapters'
import {
  buildFlowEditorView,
  captureFlowEditorAuthoringTarget,
  listFlowCourseTreePages,
} from '@/renderer/course/flowEditorView'
import { selectFlowEditorBlocks, selectFlowOverlay } from '@/renderer/course/flowEditorSlice'
import {
  buildFlowRichTextHtml,
  formatFlowAuthoringTextStyle,
  markFlowTextComposing,
  updateFlowTextDraft,
} from '@/renderer/authoring/flowTextEdit'
import {
  selectActiveCourseProjectDocument,
  selectEditingScope,
  selectSlideAuthoringBackend,
  useEditorStore,
} from '@/renderer/store/editorStore'
import { ElementsTab } from '@/renderer/ui/ElementsTab'
import { MediaTab } from '@/renderer/ui/MediaTab'
import { NodesTab } from '@/renderer/ui/NodesTab'
import { PropertiesTab } from '@/renderer/ui/PropertiesTab'
import { usePropertiesContext } from '@/renderer/ui/properties/PropertiesContextAdapter'
import type { MultiSelectionPropertiesContext } from '@/renderer/ui/properties/MultiSelectionPropertiesPanel'
import { ScenePanel } from '@/renderer/ui/ScenePanel'
import { TopToolbar } from '@/renderer/ui/TopToolbar'
import { FlowWorkspace } from '@/renderer/ui/FlowWorkspace'
import type { AssetMeta } from '@/shared/contracts/media-v1'

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])

function flowDocument() {
  const document = selectActiveCourseProjectDocument(useEditorStore.getState())
  if (!document) throw new Error('expected course document')
  return document
}

function flowSurface() {
  const surface = flowDocument().surfaces.find((candidate) => candidate.type === 'flow')
  if (!surface || surface.type !== 'flow') throw new Error('expected flow surface')
  return surface
}

function beginDirtyFlowParagraphEdit(suffix = '—草稿') {
  const session = useEditorStore.getState().flowSession
  const authoring = useEditorStore.getState().courseAuthoringSession
  if (!session || !authoring) throw new Error('expected Flow authoring session')
  const paragraph = flowSurfaceIn(
    session.history.present,
    session.selection.surfaceId,
  ).blocks.find((block) => block.type === 'paragraph')
  if (!paragraph || paragraph.type !== 'paragraph') throw new Error('expected Flow paragraph')
  const target = captureFlowEditorAuthoringTarget({
    view: buildFlowEditorView({
      project: session.history.present,
      locationId: session.selection.locationId,
    }),
    sessionToken: authoring.token,
    target: { kind: 'block', blockId: paragraph.id },
  })
  const begun = useEditorStore.getState().runFlowAuthoringIntent(target, {
    kind: 'begin-text-edit',
    gesture: 'click-text',
    offset: paragraph.text.length,
  })
  if (!begun.ok || !begun.edit) throw new Error('expected Flow text edit')
  const editedText = `${paragraph.text}${suffix}`
  const drafted = updateFlowTextDraft(begun.edit, { text: editedText, runs: paragraph.runs ?? [] })
  const updated = useEditorStore.getState().runFlowAuthoringIntent(target, {
    kind: 'update-text-edit',
    expectedEdit: begun.edit,
    edit: drafted,
  })
  if (!updated.ok) throw new Error(updated.reason ?? 'expected Flow draft update')
  return { paragraph, target, begun: begun.edit, drafted, editedText }
}

function imageAsset(): AssetMeta {
  return {
    id: 'asset-flow-image',
    filename: 'cover.png',
    mimeType: 'image/png',
    kind: 'image',
    path: 'assets/cover.png',
    byteLength: PNG.byteLength,
    width: 64,
    height: 64,
  }
}

function FlowWorkspacePropertiesHarness() {
  const session = useEditorStore((state) => state.flowSession)
  const authoringSession = useEditorStore((state) => state.courseAuthoringSession)
  const textEdit = useEditorStore((state) => state.flowTextEdit)
  if (!session || !authoringSession) return null
  const view = buildFlowEditorView({
    project: session.history.present,
    locationId: session.selection.locationId,
  })
  return (
    <div>
      <div style={{ width: 900, height: 640 }}>
        <FlowWorkspace
          view={view}
          sessionToken={authoringSession.token}
          assets={session.history.present.assets}
          selection={session.selection}
          textEdit={textEdit}
          commands={{
            run: (target, intent) => (
              useEditorStore.getState().runFlowAuthoringIntent(target, intent)
            ),
          }}
        />
      </div>
      <PropertiesTab onReplaceImage={() => undefined} />
      <button type="button" data-testid="outside-flow-authoring">离开 Flow 编辑</button>
    </div>
  )
}

function FlowMultiPropertiesCapture({
  capture,
}: {
  capture(context: MultiSelectionPropertiesContext): void
}) {
  const context = usePropertiesContext({ onReplaceImage: () => undefined })
  if (context.kind === 'multi-selection') capture(context)
  return null
}

beforeEach(() => {
  useEditorStore.getState().createNewProject()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  useEditorStore.getState().createNewProject()
})

describe('Flow product shell wiring', () => {
  it('routes Flow overlay multi-selection through one exact canonical transaction', () => {
    useEditorStore.getState().createNewFlowProject()
    useEditorStore.getState().addRectangleNode(80, 70)
    useEditorStore.getState().addRectangleNode(360, 210)
    const inserted = useEditorStore.getState().flowSession
    if (!inserted) throw new Error('expected Flow session')
    const overlayIds = flowSurfaceIn(
      inserted.history.present,
      inserted.selection.surfaceId,
    ).surfaceLayerItems.map((entry) => entry.item.layerItemId).slice(-2)
    expect(overlayIds).toHaveLength(2)
    const positionedResult = patchEffectiveLayerPropertiesAtTargets(
      inserted.history.present,
      overlayIds.map((id, index) => {
        const located = locateCourseLayer(inserted.history.present, id)
        if (!located) throw new Error('expected Flow overlay')
        return {
          target: {
            authoringAddress: makeEffectiveLayerAuthoringAddress(
              inserted.history.present.id,
              located,
            ),
            locationId: inserted.selection.locationId,
          },
          patch: { frame: index === 0 ? { x: 80, y: 70 } : { x: 360, y: 210 } },
        }
      }),
      { expectedRevision: inserted.history.present.revision },
    )
    useEditorStore.getState().applyFlowCommand(positionedResult)
    const positioned = useEditorStore.getState().flowSession!
    expect(overlayIds.map((id) => locateCourseLayer(
      positioned.history.present,
      id,
    )?.item.frame.x)).toEqual([80, 360])
    act(() => useEditorStore.getState().applyFlowSelection(selectFlowOverlay(
      positioned.history.present,
      positioned.selection.locationId,
      overlayIds,
      'page',
    )))

    let captured: MultiSelectionPropertiesContext | null = null
    render(
      <>
        <PropertiesTab onReplaceImage={() => undefined} />
        <FlowMultiPropertiesCapture capture={(context) => { captured = context }} />
      </>,
    )
    expect(screen.getByTestId('multi-selection-properties')).toHaveTextContent('2')
    expect(screen.getByRole('button', { name: '复制所选' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '删除所选' })).toBeEnabled()

    const beforeAlign = useEditorStore.getState().flowSession!
    fireEvent.click(screen.getByRole('button', { name: '左对齐' }))
    const aligned = useEditorStore.getState().flowSession!
    expect(aligned.history.present.revision).toBe(beforeAlign.history.present.revision + 1)
    expect(aligned.history.past).toHaveLength(beforeAlign.history.past.length + 1)
    expect(aligned.selection.selectedOverlayIds).toEqual(overlayIds)
    const alignedFrames = overlayIds.map((id) => locateCourseLayer(
      aligned.history.present,
      id,
    )?.item.frame)
    expect(alignedFrames[0]?.x).toBe(alignedFrames[1]?.x)

    const capturedContext = captured as MultiSelectionPropertiesContext | null
    if (!capturedContext) throw new Error('expected captured Flow multi Properties context')
    const staleCommands = capturedContext.commands
    act(() => useEditorStore.getState().applyFlowSelection(selectFlowOverlay(
      aligned.history.present,
      aligned.selection.locationId,
      [overlayIds[0]!],
      'page',
    )))
    const beforeStale = useEditorStore.getState().flowSession!
    act(() => staleCommands.setVisible(false))
    const afterStale = useEditorStore.getState().flowSession!
    expect(afterStale.history.present).toBe(beforeStale.history.present)
    expect(afterStale.history).toBe(beforeStale.history)
    expect(afterStale.selection).toBe(beforeStale.selection)

    act(() => useEditorStore.getState().applyFlowSelection(selectFlowOverlay(
      afterStale.history.present,
      afterStale.selection.locationId,
      overlayIds,
      'page',
    )))
    const beforeHide = useEditorStore.getState().flowSession!
    fireEvent.click(screen.getByRole('button', { name: '全部隐藏' }))
    const hidden = useEditorStore.getState().flowSession!
    expect(hidden.history.present.revision).toBe(beforeHide.history.present.revision + 1)
    expect(hidden.history.past).toHaveLength(beforeHide.history.past.length + 1)
    for (const id of overlayIds) {
      expect(locateCourseLayer(hidden.history.present, id)?.item.visible).toBe(false)
    }

    const beforeDelete = hidden
    fireEvent.click(screen.getByRole('button', { name: '删除所选' }))
    const deleted = useEditorStore.getState().flowSession!
    expect(deleted.history.present.revision).toBe(beforeDelete.history.present.revision + 1)
    expect(deleted.history.past).toHaveLength(beforeDelete.history.past.length + 1)
    expect(deleted.selection.selectedOverlayIds).toEqual([])
    for (const id of overlayIds) expect(locateCourseLayer(deleted.history.present, id)).toBeNull()
  })

  it('rejects Delete from stale rendered Flow props without overwriting newer store content', () => {
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    })
    useEditorStore.getState().createNewFlowProject()
    const initial = useEditorStore.getState().flowSession
    if (!initial) throw new Error('expected Flow session')
    const surface = flowSurfaceIn(initial.history.present, initial.selection.surfaceId)
    const paragraph = surface.blocks.find((block) => block.type === 'paragraph')
    if (!paragraph) throw new Error('expected Flow paragraph')
    const staleSelection = selectFlowEditorBlocks(
      initial.history.present,
      initial.selection.locationId,
      [paragraph.id],
    )
    useEditorStore.getState().applyFlowSelection(staleSelection)
    const staleProject = flowDocument()
    const staleView = buildFlowEditorView({
      project: staleProject,
      locationId: staleSelection.locationId,
    })
    const staleToken = useEditorStore.getState().courseAuthoringSession?.token
    if (!staleToken) throw new Error('expected Flow authoring token')
    const run = vi.fn((target, intent) => (
      useEditorStore.getState().runFlowAuthoringIntent(target, intent)
    ))
    render(
      <FlowWorkspace
        view={staleView}
        sessionToken={staleToken}
        assets={staleProject.assets}
        selection={staleSelection}
        textEdit={null}
        commands={{ run }}
      />,
    )
    const inserted = insertFlowEditorBlock(flowDocument(), {
      surfaceId: surface.id,
      parentId: null,
      index: surface.blocks.length,
      block: { type: 'paragraph', text: '新版本内容' },
    }, { expectedRevision: flowDocument().revision })
    useEditorStore.getState().applyFlowCommand(inserted)
    const beforeDocument = flowDocument()
    const beforeHistory = useEditorStore.getState().flowSession!.history.past
    const beforeSelection = useEditorStore.getState().flowSession!.selection

    fireEvent.keyDown(screen.getByTestId(`flow-block-${paragraph.id}`), { key: 'Delete' })

    expect(run).toHaveBeenCalledOnce()
    expect(run.mock.results[0]?.value).toMatchObject({ ok: false, historyEntry: false })
    expect(flowDocument()).toBe(beforeDocument)
    expect(useEditorStore.getState().flowSession!.history.past).toBe(beforeHistory)
    expect(useEditorStore.getState().flowSession!.selection).toBe(beforeSelection)
    expect(flowSurface().blocks.some((block) => block.id === paragraph.id)).toBe(true)
    expect(flowSurface().blocks.some((block) => (
      block.type === 'paragraph' && block.text === '新版本内容'
    ))).toBe(true)
  })

  it('rejects a stale media callback without touching document, history, edit, or resources', () => {
    useEditorStore.getState().createNewFlowProject()
    useEditorStore.getState().importAsset(imageAsset(), PNG)
    const inserted = useEditorStore.getState().insertFlowLibraryMedia(
      imageAsset().id,
      { menuAction: 'insert-document' },
    )
    expect(inserted.ok).toBe(true)

    const insertedSession = useEditorStore.getState().flowSession
    const insertedAuthoring = useEditorStore.getState().courseAuthoringSession
    if (!insertedSession || !insertedAuthoring) throw new Error('expected Flow authoring session')
    const media = flowSurfaceIn(
      insertedSession.history.present,
      insertedSession.selection.surfaceId,
    ).blocks.find((block) => block.type === 'media' && block.assetId === imageAsset().id)
    if (!media || media.type !== 'media') throw new Error('expected inserted Flow media')
    const staleTarget = captureFlowEditorAuthoringTarget({
      view: buildFlowEditorView({
        project: insertedSession.history.present,
        locationId: insertedSession.selection.locationId,
      }),
      sessionToken: insertedAuthoring.token,
      target: { kind: 'block', blockId: media.id },
    })

    const paragraph = flowSurface().blocks.find((block) => block.type === 'paragraph')
    if (!paragraph || paragraph.type !== 'paragraph') throw new Error('expected paragraph')
    useEditorStore.getState().applyFlowCommand(updateFlowEditorBlock(
      flowDocument(),
      {
        surfaceId: insertedSession.selection.surfaceId,
        blockId: paragraph.id,
        parentId: null,
      },
      { text: '中间版本内容' },
      { expectedRevision: flowDocument().revision },
    ))

    const before = useEditorStore.getState()
    const beforeSession = before.flowSession!
    const receipt = before.runFlowAuthoringIntent(staleTarget, {
      kind: 'import-replacement-media',
      name: 'replacement.png',
      mimeType: 'image/png',
      bytes: Uint8Array.from([1, 2, 3, 4]),
    })
    const after = useEditorStore.getState()

    expect(receipt).toMatchObject({ ok: false, historyEntry: false })
    expect(after.flowSession?.history.present).toBe(beforeSession.history.present)
    expect(after.flowSession?.history.present.revision).toBe(beforeSession.history.present.revision)
    expect(after.flowSession?.history.past).toBe(beforeSession.history.past)
    expect(after.flowSession?.history.future).toBe(beforeSession.history.future)
    expect(after.flowSession?.selection).toBe(beforeSession.selection)
    expect(after.flowTextEdit).toBe(before.flowTextEdit)
    expect(after.courseAssetSidecar).toBe(before.courseAssetSidecar)
    expect(after.courseAssetSidecarPast).toBe(before.courseAssetSidecarPast)
    expect(after.courseAssetSidecarFuture).toBe(before.courseAssetSidecarFuture)
    expect(after.assetFiles).toBe(before.assetFiles)
    expect(after.componentPackages).toBe(before.componentPackages)
    expect(after.courseAuthoringSession).toBe(before.courseAuthoringSession)
    expect(after.dirty).toBe(before.dirty)
  })

  it('rejects delayed callbacks from an older edit object at the same revision', () => {
    useEditorStore.getState().createNewFlowProject()
    const session = useEditorStore.getState().flowSession
    const authoring = useEditorStore.getState().courseAuthoringSession
    if (!session || !authoring) throw new Error('expected Flow authoring session')
    const paragraph = flowSurfaceIn(
      session.history.present,
      session.selection.surfaceId,
    ).blocks.find((block) => block.type === 'paragraph')
    if (!paragraph) throw new Error('expected paragraph')
    const target = captureFlowEditorAuthoringTarget({
      view: buildFlowEditorView({
        project: session.history.present,
        locationId: session.selection.locationId,
      }),
      sessionToken: authoring.token,
      target: { kind: 'block', blockId: paragraph.id },
    })

    const begunA = useEditorStore.getState().runFlowAuthoringIntent(target, {
      kind: 'begin-text-edit',
      gesture: 'click-text',
      offset: 0,
    })
    if (!begunA.ok || !begunA.edit) throw new Error('expected first edit')
    expect(useEditorStore.getState().runFlowAuthoringIntent(target, {
      kind: 'cancel-text-edit',
      edit: begunA.edit,
    }).ok).toBe(true)
    const begunB = useEditorStore.getState().runFlowAuthoringIntent(target, {
      kind: 'begin-text-edit',
      gesture: 'click-text',
      offset: 0,
    })
    if (!begunB.ok || !begunB.edit) throw new Error('expected second edit')
    expect(begunB.edit).not.toBe(begunA.edit)
    expect(begunB.edit.revision).toBe(begunA.edit.revision)

    const before = useEditorStore.getState()
    const beforeSession = before.flowSession!
    const staleReceipts = [
      before.runFlowAuthoringIntent(target, {
        kind: 'update-text-edit',
        expectedEdit: begunA.edit,
        edit: begunA.edit,
      }),
      before.runFlowAuthoringIntent(target, {
        kind: 'format-text-style',
        expectedEdit: begunA.edit,
        style: { bold: true },
      }),
      before.runFlowAuthoringIntent(target, {
        kind: 'cancel-text-edit',
        edit: begunA.edit,
      }),
      before.runFlowAuthoringIntent(target, {
        kind: 'commit-text-edit',
        edit: begunA.edit,
      }),
    ]
    const after = useEditorStore.getState()

    for (const receipt of staleReceipts) {
      expect(receipt).toMatchObject({ ok: false, historyEntry: false })
    }
    expect(after.flowTextEdit).toBe(begunB.edit)
    expect(after.flowSession?.history.present).toBe(beforeSession.history.present)
    expect(after.flowSession?.history.past).toBe(beforeSession.history.past)
    expect(after.flowSession?.history.future).toBe(beforeSession.history.future)
    expect(after.flowSession?.selection).toBe(beforeSession.selection)
    expect(after.courseAssetSidecar).toBe(before.courseAssetSidecar)
    expect(after.courseAssetSidecarPast).toBe(before.courseAssetSidecarPast)
    expect(after.courseAssetSidecarFuture).toBe(before.courseAssetSidecarFuture)
    expect(after.courseAuthoringSession).toBe(before.courseAuthoringSession)
  })

  it('commits the Store-owned draft before a legacy tree selection changes blocks', () => {
    useEditorStore.getState().createNewFlowProject()
    const { paragraph, editedText } = beginDirtyFlowParagraphEdit('—切换前提交')
    const before = useEditorStore.getState().flowSession!
    const nextBlock = flowSurfaceIn(
      before.history.present,
      before.selection.surfaceId,
    ).blocks.find((block) => block.id !== paragraph.id)
    if (!nextBlock) throw new Error('expected another Flow block')
    const nextSelection = selectFlowEditorBlocks(
      before.history.present,
      before.selection.locationId,
      [nextBlock.id],
    )

    useEditorStore.getState().applyFlowSelection(nextSelection)

    const after = useEditorStore.getState().flowSession!
    const committed = findFlowBlockRecursive(
      flowSurfaceIn(after.history.present, after.selection.surfaceId).blocks,
      paragraph.id,
    )?.block
    expect(committed).toMatchObject({ type: 'paragraph', text: editedText })
    expect(after.selection.selectedBlockId).toBe(nextBlock.id)
    expect(after.history.past).toHaveLength(before.history.past.length + 1)
    expect(useEditorStore.getState().flowTextEdit).toBeNull()
  })

  it('keeps a composing draft and selection unchanged when a tree transition cannot commit', () => {
    useEditorStore.getState().createNewFlowProject()
    const { paragraph, target, drafted } = beginDirtyFlowParagraphEdit('—输入法合成中')
    const composing = markFlowTextComposing(drafted, true)
    expect(useEditorStore.getState().runFlowAuthoringIntent(target, {
      kind: 'update-text-edit',
      expectedEdit: drafted,
      edit: composing,
    }).ok).toBe(true)
    const before = useEditorStore.getState()
    const beforeSession = before.flowSession!
    const nextBlock = flowSurfaceIn(
      beforeSession.history.present,
      beforeSession.selection.surfaceId,
    ).blocks.find((block) => block.id !== paragraph.id)
    if (!nextBlock) throw new Error('expected another Flow block')

    before.applyFlowSelection(selectFlowEditorBlocks(
      beforeSession.history.present,
      beforeSession.selection.locationId,
      [nextBlock.id],
    ))

    const after = useEditorStore.getState()
    expect(after.flowTextEdit).toBe(composing)
    expect(after.flowSession?.history.present).toBe(beforeSession.history.present)
    expect(after.flowSession?.history.past).toBe(beforeSession.history.past)
    expect(after.flowSession?.history.future).toBe(beforeSession.history.future)
    expect(after.flowSession?.selection).toBe(beforeSession.selection)
    expect(after.courseAssetSidecar).toBe(before.courseAssetSidecar)
    expect(after.courseAuthoringSession).toBe(before.courseAuthoringSession)
  })

  it('does not consume redo history or discard a dirty Store-owned edit', () => {
    useEditorStore.getState().createNewFlowProject()
    const initial = useEditorStore.getState().flowSession!
    const paragraph = flowSurfaceIn(
      initial.history.present,
      initial.selection.surfaceId,
    ).blocks.find((block) => block.type === 'paragraph')
    if (!paragraph || paragraph.type !== 'paragraph') throw new Error('expected paragraph')
    expect(useEditorStore.getState().applyFlowCommand(updateFlowEditorBlock(
      initial.history.present,
      { surfaceId: initial.selection.surfaceId, blockId: paragraph.id, parentId: null },
      { text: `${paragraph.text}—可重做` },
      { expectedRevision: initial.history.present.revision },
    )).ok).toBe(true)
    useEditorStore.getState().undo()
    beginDirtyFlowParagraphEdit('—未提交')
    const before = useEditorStore.getState()
    const beforeSession = before.flowSession!
    expect(beforeSession.history.future.length).toBeGreaterThan(0)

    before.redo()

    const after = useEditorStore.getState()
    expect(after.flowTextEdit).toBe(before.flowTextEdit)
    expect(after.flowSession?.history.present).toBe(beforeSession.history.present)
    expect(after.flowSession?.history.past).toBe(beforeSession.history.past)
    expect(after.flowSession?.history.future).toBe(beforeSession.history.future)
    expect(after.flowSession?.selection).toBe(beforeSession.selection)
    expect(after.courseAssetSidecar).toBe(before.courseAssetSidecar)
    expect(after.courseAuthoringSession).toBe(before.courseAuthoringSession)
  })

  it('commits a Flow draft before opening a location on another Surface', () => {
    useEditorStore.getState().createNewProject()
    useEditorStore.getState().addCourseContent('flow-page')
    const slideLocation = flowDocument().locations.find((location) => location.kind === 'slide-scene')
    if (!slideLocation) throw new Error('expected Slide location')
    const { paragraph, editedText } = beginDirtyFlowParagraphEdit('—跨 Surface 提交')
    const beforePastLength = useEditorStore.getState().flowSession!.history.past.length

    useEditorStore.getState().activateCourseLocation(slideLocation.id)

    const afterDocument = flowDocument()
    const flow = afterDocument.surfaces.find((surface) => surface.type === 'flow')
    if (!flow || flow.type !== 'flow') throw new Error('expected Flow surface')
    expect(findFlowBlockRecursive(flow.blocks, paragraph.id)?.block).toMatchObject({
      type: 'paragraph',
      text: editedText,
    })
    expect(useEditorStore.getState().flowTextEdit).toBeNull()
    expect(useEditorStore.getState().flowSession).toBeNull()
    expect(selectSlideAuthoringBackend(useEditorStore.getState())).not.toBeNull()
    expect(selectSlideAuthoringBackend(useEditorStore.getState())?.getSession().history.past)
      .toHaveLength(beforePastLength + 1)
  })

  it('preserves the draft and the first legacy panel mutation for media, elements, and layers', () => {
    useEditorStore.getState().createNewFlowProject()
    useEditorStore.getState().importAsset(imageAsset(), PNG)

    const mediaEdit = beginDirtyFlowParagraphEdit('—媒体点击')
    const mediaResult = useEditorStore.getState().insertFlowLibraryMedia(
      imageAsset().id,
      { menuAction: 'insert-document' },
    )
    expect(mediaResult.ok).toBe(true)
    expect(findFlowBlockRecursive(flowSurface().blocks, mediaEdit.paragraph.id)?.block)
      .toMatchObject({ type: 'paragraph', text: mediaEdit.editedText })
    expect(flowSurface().blocks).toContainEqual(expect.objectContaining({
      type: 'media',
      assetId: imageAsset().id,
    }))

    const elementEdit = beginDirtyFlowParagraphEdit('—元素点击')
    const blockCountBefore = flowSurface().blocks.length
    useEditorStore.getState().addTextNode()
    expect(findFlowBlockRecursive(flowSurface().blocks, elementEdit.paragraph.id)?.block)
      .toMatchObject({ type: 'paragraph', text: elementEdit.editedText })
    expect(flowSurface().blocks).toHaveLength(blockCountBefore + 1)

    const shapeEdit = beginDirtyFlowParagraphEdit('—图形点击')
    useEditorStore.getState().addRectangleNode()
    expect(findFlowBlockRecursive(flowSurface().blocks, shapeEdit.paragraph.id)?.block)
      .toMatchObject({ type: 'paragraph', text: shapeEdit.editedText })
    const overlayId = useEditorStore.getState().flowSession?.selection.selectedOverlayIds[0]
    if (!overlayId) throw new Error('expected inserted Flow overlay')

    const layerEdit = beginDirtyFlowParagraphEdit('—图层点击')
    useEditorStore.getState().updateNode(overlayId, { visible: false })
    expect(findFlowBlockRecursive(flowSurface().blocks, layerEdit.paragraph.id)?.block)
      .toMatchObject({ type: 'paragraph', text: layerEdit.editedText })
    expect(locateCourseLayer(flowDocument(), overlayId)?.item.visible).toBe(false)
    expect(useEditorStore.getState().flowTextEdit).toBeNull()
  })

  it('commits an open text draft and a follow-up block command as one undo step', () => {
    useEditorStore.getState().createNewFlowProject()
    const session = useEditorStore.getState().flowSession
    const authoring = useEditorStore.getState().courseAuthoringSession
    if (!session || !authoring) throw new Error('expected Flow authoring session')
    const paragraph = flowSurfaceIn(
      session.history.present,
      session.selection.surfaceId,
    ).blocks.find((block) => block.type === 'paragraph')
    if (!paragraph || paragraph.type !== 'paragraph') throw new Error('expected paragraph')
    const originalText = paragraph.text
    const target = captureFlowEditorAuthoringTarget({
      view: buildFlowEditorView({
        project: session.history.present,
        locationId: session.selection.locationId,
      }),
      sessionToken: authoring.token,
      target: { kind: 'block', blockId: paragraph.id },
    })
    const begun = useEditorStore.getState().runFlowAuthoringIntent(target, {
      kind: 'begin-text-edit',
      gesture: 'click-text',
      offset: 0,
    })
    if (!begun.ok || !begun.edit) throw new Error('expected Flow text edit')
    const editedText = `${originalText}—已修改`
    const drafted = updateFlowTextDraft(begun.edit, { text: editedText, runs: [] })
    const updated = useEditorStore.getState().runFlowAuthoringIntent(target, {
      kind: 'update-text-edit',
      expectedEdit: begun.edit,
      edit: drafted,
    })
    expect(updated.ok).toBe(true)
    expect(updated.historyEntry).toBe(false)

    const before = useEditorStore.getState().flowSession!
    const receipt = useEditorStore.getState().runFlowAuthoringIntent(target, {
      kind: 'format-block',
      spec: { kind: 'convert-quote' },
      expectedEdit: drafted,
    })
    const after = useEditorStore.getState().flowSession!
    const committed = flowSurfaceIn(
      after.history.present,
      after.selection.surfaceId,
    ).blocks.find((block) => block.id === paragraph.id)

    expect(receipt).toMatchObject({ ok: true, historyEntry: true })
    expect(useEditorStore.getState().flowTextEdit).toBeNull()
    expect(after.history.past).toHaveLength(before.history.past.length + 1)
    expect(committed).toMatchObject({ type: 'quote', text: editedText })

    useEditorStore.getState().undo()
    const undone = flowSurfaceIn(
      useEditorStore.getState().flowSession!.history.present,
      after.selection.surfaceId,
    ).blocks.find((block) => block.id === paragraph.id)
    expect(undone).toMatchObject({ type: 'paragraph', text: originalText })
  })

  it('keeps default new project on Slide and adds a visible blank Flow entry without removing Spatial', () => {
    expect(flowDocument().surfaces[0]?.type).toBe('slide')
    expect(useEditorStore.getState().flowSession).toBeNull()
    expect(useEditorStore.getState().spatialSession).toBeNull()

    render(
      <TopToolbar
        busy={false}
        onNew={() => useEditorStore.getState().createNewProject()}
        onNewSpatial={() => useEditorStore.getState().createNewSpatialProject()}
        onNewFlow={() => useEditorStore.getState().createNewFlowProject()}
        onOpen={() => undefined}
        recentProjects={[]}
        onOpenRecent={() => undefined}
        onSave={() => undefined}
        healthSummary={{ error: 0, warning: 0, info: 0, total: 0, canExport: true }}
        onOpenHealth={() => undefined}
        onPreview={() => undefined}
        onExport={() => undefined}
      />,
    )
    expect(screen.getByTestId('new-spatial-project')).toBeTruthy()
    fireEvent.click(screen.getByTestId('new-flow-project'))
    expect(flowDocument().surfaces[0]?.type).toBe('flow')
    expect(useEditorStore.getState().flowSession).not.toBeNull()
    expect(useEditorStore.getState().spatialSession).toBeNull()
    expect(flowDocument().schemaVersion).toBe(9)
  })

  it('shows course tree pages and headings, hides paragraphs, cameras, and slide add-scene', () => {
    useEditorStore.getState().createNewFlowProject()
    const startRevision = flowDocument().revision
    const flow = useEditorStore.getState().flowSession
    if (!flow) throw new Error('expected flow session')
    const surface = flowSurface()
    const paragraph = surface.blocks.find((block) => block.type === 'paragraph')
    if (!paragraph || paragraph.type !== 'paragraph') throw new Error('expected blank paragraph')
    const found = findFlowBlockRecursive(surface.blocks, paragraph.id)
    useEditorStore.getState().applyFlowCommand(updateFlowEditorBlock(flow.history.present, {
      surfaceId: surface.id,
      blockId: paragraph.id,
      parentId: found?.parentId ?? null,
    }, { text: '第二段不应出现在课程树' }, { expectedRevision: flow.history.present.revision }))

    render(<ScenePanel />)
    expect(screen.getByText('课程结构')).toBeTruthy()
    expect(screen.getByText('全局层（全课）')).toBeTruthy()
    const addPrimary = screen.getByTestId('add-content-primary')
    expect(addPrimary).toBeTruthy()
    expect(addPrimary.getAttribute('data-alias-testid')).toBe('add-flow-page')
    expect(screen.queryByTestId('add-scene')).toBeNull()
    expect(screen.queryByText('本页镜头')).toBeNull()
    expect(screen.queryByTestId('add-spatial-camera')).toBeNull()
    expect(screen.getByText('无标题')).toBeTruthy()
    expect(screen.queryByText('第二段不应出现在课程树')).toBeNull()

    const pages = listFlowCourseTreePages(flowDocument())
    const heading = pages[0]?.headings[0]
    expect(heading).toBeTruthy()
    const beforeSelect = flowDocument().revision
    fireEvent.click(screen.getByTestId(`flow-heading-${heading!.locationId}`))
    expect(flowDocument().revision).toBe(beforeSelect)
    expect(startRevision).toBeLessThan(flowDocument().revision + 1)
  })

  it('writes one history revision for paper commands and formats text without a body textarea', () => {
    useEditorStore.getState().createNewFlowProject()
    const startRevision = flowDocument().revision
    render(<ElementsTab onAddImage={() => undefined} />)
    fireEvent.click(screen.getByTestId('add-text'))
    expect(useEditorStore.getState().errorMessage).toBeNull()
    expect(flowDocument().revision).toBe(startRevision + 1)
    const createdId = useEditorStore.getState().flowSession?.selection.selectedBlockId
    expect(createdId).toBeTruthy()
    const created = findFlowBlockRecursive(flowSurface().blocks, createdId!)
    expect(created?.block.type).toBe('paragraph')

    const heading = flowSurface().blocks.find((block) => block.type === 'heading')
    expect(heading && heading.type === 'heading').toBe(true)
    const flow = useEditorStore.getState().flowSession
    if (!flow || !heading) throw new Error('expected flow heading')
    useEditorStore.setState({
      flowSession: {
        ...flow,
        selection: selectFlowEditorBlocks(flow.history.present, flow.selection.locationId, [heading.id]),
      },
    })

    cleanup()
    render(<PropertiesTab onReplaceImage={() => undefined} />)
    expect(screen.queryByLabelText('文字内容')).toBeNull()
    expect(screen.queryByText('文字内容')).toBeNull()
    fireEvent.click(screen.getByTestId('flow-format-bold'))
    const formatted = flowSurface().blocks.find((block) => block.type === 'heading')
    expect(formatted && formatted.type === 'heading' ? formatted.runs?.some((run) => run.style?.bold) : false).toBe(true)
  })

  it('keeps no-edit collapsed formatting a no-op and treats omitted range as whole target', () => {
    useEditorStore.getState().createNewFlowProject()
    const flow = useEditorStore.getState().flowSession
    if (!flow) throw new Error('expected flow session')
    const paragraph = flowSurface().blocks.find((block) => block.type === 'paragraph')
    if (!paragraph || paragraph.type !== 'paragraph') throw new Error('expected paragraph')
    const updated = updateFlowEditorBlock(flow.history.present, {
      surfaceId: flow.selection.surfaceId,
      blockId: paragraph.id,
      parentId: null,
    }, { text: 'ABCD' }, { expectedRevision: flow.history.present.revision })
    if (!updated.nextDocument) throw new Error('expected updated document')
    const legacyCaret = selectFlowEditorBlocks(
      updated.nextDocument,
      flow.selection.locationId,
      [paragraph.id],
      {
        focus: 'text',
        textRange: { blockId: paragraph.id, start: 2, end: 2 },
      },
    )

    const collapsed = formatFlowAuthoringTextStyle({
      document: updated.nextDocument,
      selection: legacyCaret,
      style: { italic: true },
      range: { start: 2, end: 2 },
    })
    expect(collapsed.historyEntry).toBe(false)
    expect(collapsed.nextDocument).toBe(updated.nextDocument)

    const whole = formatFlowAuthoringTextStyle({
      document: updated.nextDocument,
      selection: legacyCaret,
      style: { bold: true },
    })
    expect(whole.historyEntry).toBe(true)
    const wholeParagraph = findFlowBlockRecursive(
      flowSurfaceIn(whole.nextDocument!, flow.selection.surfaceId).blocks,
      paragraph.id,
    )?.block
    expect(wholeParagraph?.type).toBe('paragraph')
    expect(wholeParagraph?.type === 'paragraph' ? wholeParagraph.runs : []).toEqual([
      { start: 0, end: 4, style: { bold: true } },
    ])

    const withList = insertFlowEditorBlock(updated.nextDocument, {
      surfaceId: flow.selection.surfaceId,
      parentId: null,
      index: flowSurfaceIn(updated.nextDocument, flow.selection.surfaceId).blocks.length,
      block: {
        id: 'list-format-target',
        type: 'list',
        ordered: false,
        items: [{ id: 'list-item-format-target', text: '列表项' }],
      },
    }, { expectedRevision: updated.nextDocument.revision })
    const nestedSelection = selectFlowEditorBlocks(
      withList.nextDocument!,
      flow.selection.locationId,
      ['list-format-target'],
      {
        focus: 'text',
        textRange: {
          blockId: 'list-format-target',
          listItemId: 'list-item-format-target',
          start: 1,
          end: 1,
        },
      },
    )
    const nestedWhole = formatFlowAuthoringTextStyle({
      document: withList.nextDocument!,
      selection: nestedSelection,
      style: { underline: true },
    })
    const nestedList = findFlowBlockRecursive(
      flowSurfaceIn(nestedWhole.nextDocument!, flow.selection.surfaceId).blocks,
      'list-format-target',
    )?.block
    expect(nestedList?.type === 'list' ? nestedList.items[0]?.runs : []).toEqual([
      { start: 0, end: 3, style: { underline: true } },
    ])
  })

  it('hands a live Flow range to Properties and commits the formatted draft once on exit', async () => {
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      disconnect() {}
    })
    useEditorStore.getState().createNewFlowProject()
    const initialFlow = useEditorStore.getState().flowSession
    if (!initialFlow) throw new Error('expected flow session')
    const paragraph = flowSurface().blocks.find((block) => block.type === 'paragraph')
    if (!paragraph || paragraph.type !== 'paragraph') throw new Error('expected paragraph')
    useEditorStore.getState().applyFlowCommand(updateFlowEditorBlock(initialFlow.history.present, {
      surfaceId: initialFlow.selection.surfaceId,
      blockId: paragraph.id,
      parentId: null,
    }, { text: 'ABCD', runs: [] }, { expectedRevision: initialFlow.history.present.revision }))
    const readyFlow = useEditorStore.getState().flowSession!
    useEditorStore.getState().applyFlowSelection(selectFlowEditorBlocks(
      readyFlow.history.present,
      readyFlow.selection.locationId,
      [paragraph.id],
      {
        focus: 'text',
        textRange: { blockId: paragraph.id, start: 1, end: 3 },
      },
    ))
    const revisionBeforeFormat = flowDocument().revision
    const historyLengthBeforeFormat = useEditorStore.getState().flowSession!.history.past.length

    render(<FlowWorkspacePropertiesHarness />)
    await waitFor(() => {
      expect(useEditorStore.getState().flowTextEdit?.range).toEqual({ start: 1, end: 3 })
    })
    const editor = screen.getByTestId('flow-inline-editor')
    const properties = screen.getByTestId('flow-selection-format-properties')
    const bold = screen.getByTestId('flow-format-bold')
    expect(properties).toHaveAttribute('data-flow-selection-preserving-target', 'true')

    act(() => editor.focus())
    act(() => bold.focus())
    expect(useEditorStore.getState().flowTextEdit).not.toBeNull()
    fireEvent.click(bold)
    await waitFor(() => {
      const draftRuns = (useEditorStore.getState().flowTextEdit?.draft as {
        runs?: Array<{ start: number; end: number; style: { bold?: boolean } }>
      }).runs ?? []
      expect(draftRuns.some((run) => run.start === 1 && run.end === 3 && run.style.bold)).toBe(true)
    })
    expect(flowDocument().revision).toBe(revisionBeforeFormat)
    expect(useEditorStore.getState().flowSession!.history.past).toHaveLength(historyLengthBeforeFormat)

    act(() => screen.getByTestId('outside-flow-authoring').focus())
    await waitFor(() => {
      expect(useEditorStore.getState().flowTextEdit).toBeNull()
      expect(flowDocument().revision).toBe(revisionBeforeFormat + 1)
      expect(useEditorStore.getState().flowSession?.selection.focus).toBe('block')
    })
    expect(useEditorStore.getState().flowSession!.history.past).toHaveLength(
      historyLengthBeforeFormat + 1,
    )
    const committed = findFlowBlockRecursive(flowSurface().blocks, paragraph.id)?.block
    if (!committed || committed.type !== 'paragraph') throw new Error('expected committed paragraph')
    for (let index = 0; index < 4; index += 1) {
      const boldAtIndex = committed.runs?.some(
        (run) => run.start <= index && run.end > index && run.style.bold,
      ) ?? false
      expect(boldAtIndex).toBe(index >= 1 && index < 3)
    }
  })

  it('makes Flow entries click-only and names document blocks separately from overlays', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
      () => null as never,
    )
    useEditorStore.getState().createNewFlowProject()
    const onAddImage = vi.fn()
    const onAddVideo = vi.fn()
    render(
      <ElementsTab
        onAddImage={onAddImage}
        onAddVideo={onAddVideo}
      />,
    )

    expect(screen.getByTestId('surface-insertion-hint')).toHaveTextContent(
      '流式讲义：单击添加文档块；图形添加为页面浮层。当前不可从面板拖入。',
    )
    const documentBlockEntries = [
      ['add-text', '文档段落'],
      ['add-formula', '独立公式块'],
      ['add-image', '文中图片块'],
      ['add-video', '文中视频块'],
    ] as const
    const setData = vi.fn()
    for (const [testId, carrierLabel] of documentBlockEntries) {
      const entry = screen.getByTestId(testId)
      expect(entry).toHaveProperty('draggable', false)
      expect(entry).toHaveAttribute('data-insertion-carrier', 'document-block')
      expect(entry).toHaveAttribute('title', expect.stringContaining(carrierLabel))
      fireEvent.dragStart(entry, { dataTransfer: { setData } })
    }
    const rectangle = screen.getByTestId('add-rectangle')
    expect(rectangle).toHaveProperty('draggable', false)
    expect(rectangle).toHaveAttribute('data-insertion-carrier', 'page-overlay')
    expect(rectangle).toHaveAttribute('title', expect.stringContaining('页面浮层'))
    fireEvent.dragStart(rectangle, { dataTransfer: { setData } })
    expect(setData).not.toHaveBeenCalled()

    const initialBlockCount = flowSurface().blocks.length
    fireEvent.click(screen.getByTestId('add-text'))
    expect(flowSurface().blocks).toHaveLength(initialBlockCount + 1)
    expect(useEditorStore.getState().flowSession?.selection.selectedBlockId).toBeTruthy()

    fireEvent.click(rectangle)
    const overlayId = useEditorStore.getState().flowSession?.selection.selectedOverlayIds[0]
    expect(overlayId).toBeTruthy()
    expect(readFlowSharedOwnership(flowDocument(), overlayId!)).toBe('viewport-overlay')
    expect(locateCourseLayer(flowDocument(), overlayId!)?.item).toBeTruthy()
    expect(useEditorStore.getState().errorMessage).toBeNull()

    fireEvent.click(screen.getByTestId('add-image'))
    fireEvent.click(screen.getByTestId('add-video'))
    expect(onAddImage).toHaveBeenCalledTimes(1)
    expect(onAddVideo).toHaveBeenCalledTimes(1)

    onAddImage.mockClear()
    onAddVideo.mockClear()
    act(() => useEditorStore.getState().setEditingScope('global'))
    expect(screen.getByTestId('surface-insertion-hint')).toHaveTextContent(
      'Flow 全局层：图形添加为全局浮层；文字和公式仍添加到当前文档页',
    )
    expect(screen.getByTestId('global-elements-notice')).toHaveTextContent(
      '在上方快速添加中，当前只有图形会添加为跨页全局浮层',
    )

    for (const testId of ['add-text', 'add-formula'] as const) {
      const entry = screen.getByTestId(testId)
      expect(entry).toBeEnabled()
      expect(entry).toHaveProperty('draggable', false)
      expect(entry).toHaveAttribute('data-insertion-carrier', 'document-block')
      expect(entry).toHaveAttribute('title', expect.stringContaining('不会添加到全局层'))
    }
    const globalRectangle = screen.getByTestId('add-rectangle')
    expect(globalRectangle).toBeEnabled()
    expect(globalRectangle).toHaveProperty('draggable', false)
    expect(globalRectangle).toHaveAttribute('data-insertion-carrier', 'global-layer-item')
    expect(globalRectangle).toHaveAttribute('title', expect.stringContaining('全局浮层'))

    const globalCount = flowDocument().globalLayerItems.length
    const surfaceOverlayCount = flowSurface().surfaceLayerItems.length
    fireEvent.click(globalRectangle)
    const globalOverlayId = useEditorStore.getState().flowSession?.selection.selectedOverlayIds[0]
    expect(globalOverlayId).toBeTruthy()
    expect(flowDocument().globalLayerItems.some(
      (entry) => entry.item.layerItemId === globalOverlayId,
    )).toBe(true)
    expect(flowDocument().globalLayerItems).toHaveLength(globalCount + 1)
    expect(flowSurface().surfaceLayerItems).toHaveLength(surfaceOverlayCount)

    const disabledDocument = structuredClone(flowDocument())
    const disabledHistory = structuredClone(useEditorStore.getState().flowSession?.history)
    for (const testId of ['add-image', 'add-video'] as const) {
      const entry = screen.getByTestId(testId)
      expect(entry).toBeDisabled()
      expect(entry).toHaveProperty('draggable', false)
      expect(entry).toHaveAttribute('data-insertion-carrier', 'unavailable')
      expect(entry).toHaveAttribute('title', expect.stringContaining('Flow 全局层暂不支持插入'))
      fireEvent.click(entry)
    }
    expect(onAddImage).not.toHaveBeenCalled()
    expect(onAddVideo).not.toHaveBeenCalled()
    expect(flowDocument()).toEqual(disabledDocument)
    expect(useEditorStore.getState().flowSession?.history).toEqual(disabledHistory)

    const blockCount = flowSurface().blocks.length
    fireEvent.click(screen.getByTestId('add-text'))
    expect(flowSurface().blocks).toHaveLength(blockCount + 1)
    expect(selectEditingScope(useEditorStore.getState())).toBe('scene')
    act(() => useEditorStore.getState().setEditingScope('global'))
    fireEvent.click(screen.getByTestId('add-formula'))
    expect(flowSurface().blocks).toHaveLength(blockCount + 2)
    expect(selectEditingScope(useEditorStore.getState())).toBe('global')
    expect(flowDocument().globalLayerItems).toHaveLength(globalCount + 1)
    expect(useEditorStore.getState().errorMessage).toBeNull()
  })

  it('inserts MediaTab images as document blocks and round-trips a V9 archive', () => {
    useEditorStore.getState().createNewFlowProject()
    const asset = imageAsset()
    useEditorStore.getState().importAsset(asset, PNG)
    render(<MediaTab onImportAudio={() => undefined} onImportVideo={() => undefined} />)
    fireEvent.click(screen.getByTestId(`insert-flow-media-${asset.id}`))
    expect(useEditorStore.getState().errorMessage).toBeNull()
    const mediaBlock = flowSurface().blocks.find((block) => block.type === 'media')
    expect(mediaBlock && mediaBlock.type === 'media' ? mediaBlock.assetId : null).toBe(asset.id)

    cleanup()
    render(<NodesTab />)
    expect(screen.queryByTestId(`node-item-${asset.id}`)).toBeNull()
    expect(screen.queryByText('cover.png')).toBeNull()

    const bytes = useEditorStore.getState().exportV9SlideCandidateArchive()
    expect(bytes).toBeTruthy()
    useEditorStore.getState().createNewProject()
    expect(useEditorStore.getState().flowSession).toBeNull()
    expect(useEditorStore.getState().reopenV9SlideCandidateArchive(bytes!)).toBe(true)
    expect(flowDocument().schemaVersion).toBe(9)
    expect(flowDocument().surfaces[0]?.type).toBe('flow')
    expect(flowSurface().blocks.some((block) => block.type === 'media')).toBe(true)
  })

  it('does not undo structure while IME is composing', () => {
    useEditorStore.getState().createNewFlowProject()
    const flow = useEditorStore.getState().flowSession
    if (!flow) throw new Error('expected flow session')
    useEditorStore.getState().applyFlowCommand(insertFlowEditorBlock(flow.history.present, {
      surfaceId: flow.selection.surfaceId,
      parentId: null,
      index: flowSurfaceIn(flow.history.present, flow.selection.surfaceId).blocks.length,
      block: { type: 'paragraph', text: '已提交段落' },
    }, { expectedRevision: flow.history.present.revision }))
    const afterInsert = flowDocument().revision
    useEditorStore.setState({
      flowTextEdit: {
        kind: 'rich-text',
        source: 'paper',
        blockId: flow.selection.selectedBlockId ?? 'heading',
        surfaceId: flow.selection.surfaceId,
        parentId: null,
        field: 'text',
        composing: true,
        pendingAction: null,
        revision: afterInsert,
        original: { text: '无标题', runs: [] },
        draft: { text: '无标题', runs: [] },
        range: { start: 0, end: 0 },
      },
    })
    useEditorStore.getState().undo()
    expect(flowDocument().revision).toBe(afterInsert)
    expect(flowSurface().blocks.some((block) => (
      block.type === 'paragraph' && block.text === '已提交段落'
    ))).toBe(true)
  })

  it('converts a paragraph to heading level 2 via block type select and updates course tree', () => {
    useEditorStore.getState().createNewFlowProject()
    const flow = useEditorStore.getState().flowSession
    if (!flow) throw new Error('expected flow session')
    const surface = flowSurface()
    const paragraph = surface.blocks.find((block) => block.type === 'paragraph')
    if (!paragraph || paragraph.type !== 'paragraph') throw new Error('expected blank paragraph')

    useEditorStore.setState({
      flowSession: {
        ...flow,
        selection: selectFlowEditorBlocks(flow.history.present, flow.selection.locationId, [paragraph.id]),
      },
    })

    cleanup()
    render(<PropertiesTab onReplaceImage={() => undefined} />)
    const blockTypeContainer = screen.getByTestId('flow-block-type')
    const select = blockTypeContainer.querySelector('select')
    if (!select) throw new Error('expected select inside flow-block-type')
    fireEvent.change(select, { target: { value: '2' } })

    const updated = findFlowBlockRecursive(flowSurface().blocks, paragraph.id)
    expect(updated?.block.type).toBe('heading')
    expect(updated?.block.type === 'heading' && updated.block.level).toBe(2)

    const pages = listFlowCourseTreePages(flowDocument())
    expect(pages.some((page) => page.headings.some((h) => h.locationId === paragraph.id))).toBe(true)
  })

  it('reuses live selection-format derivation in Properties for whole, mixed range, and caret states', () => {
    useEditorStore.getState().createNewFlowProject()
    const heading = flowSurface().blocks.find((block) => block.type === 'heading')
    expect(heading && heading.type === 'heading').toBe(true)
    const flow = useEditorStore.getState().flowSession
    if (!flow || !heading) throw new Error('expected flow heading')
    useEditorStore.setState({
      flowSession: {
        ...flow,
        selection: selectFlowEditorBlocks(flow.history.present, flow.selection.locationId, [heading.id]),
      },
    })

    useEditorStore.getState().formatFlowTextStyle({ color: '#dc2626' })

    cleanup()
    render(<PropertiesTab onReplaceImage={() => undefined} />)
    expect(screen.getByTestId('flow-selection-format-title')).toHaveTextContent('整块格式')
    const colorInput = screen.getByLabelText('文字颜色') as HTMLInputElement
    expect(colorInput.value).toBe('#dc2626')

    const formattedHeading = flowSurface().blocks.find((block) => block.id === heading.id)
    if (!formattedHeading || formattedHeading.type !== 'heading') throw new Error('expected formatted heading')
    const mixedRuns = [
      { start: 0, end: Array.from(formattedHeading.text).length, style: { color: '#dc2626' } },
      { start: 0, end: 1, style: { bold: true, fontFamily: 'KaiTi', fontSize: 24 } },
    ]
    const rangeEnd = Math.max(1, Array.from(formattedHeading.text).length - 1)
    const currentFlow = useEditorStore.getState().flowSession!
    useEditorStore.getState().applyFlowSelection(selectFlowEditorBlocks(
      currentFlow.history.present,
      currentFlow.selection.locationId,
      [formattedHeading.id],
      {
        focus: 'text',
        textRange: { blockId: formattedHeading.id, start: 0, end: rangeEnd },
      },
    ))
    useEditorStore.setState({
      flowTextEdit: {
        kind: 'rich-text',
        source: 'properties',
        blockId: formattedHeading.id,
        surfaceId: currentFlow.selection.surfaceId,
        parentId: null,
        field: 'text',
        composing: false,
        pendingAction: null,
        revision: flowDocument().revision,
        original: { text: formattedHeading.text, runs: mixedRuns },
        draft: { text: formattedHeading.text, runs: mixedRuns },
        range: { start: 0, end: rangeEnd },
      },
    })

    cleanup()
    render(<PropertiesTab onReplaceImage={() => undefined} />)
    expect(screen.getByTestId('flow-selection-format-title')).toHaveTextContent('选区格式')
    expect(screen.getByTestId('flow-selection-format-properties')).toHaveAttribute(
      'data-format-state',
      'mixed',
    )
    expect(screen.getByTestId('flow-font-family-state')).toHaveAttribute('data-format-state', 'mixed')
    expect(screen.getByTestId('flow-format-bold')).toHaveAttribute('aria-pressed', 'mixed')
    expect(screen.getByLabelText('文字颜色')).toHaveValue('#dc2626')

    const revisionBeforeRangeFormat = flowDocument().revision
    fireEvent.click(screen.getByTestId('flow-format-italic'))
    const editedRuns = (useEditorStore.getState().flowTextEdit?.draft as {
      runs?: Array<{ start: number; end: number; style: { italic?: boolean } }>
    }).runs ?? []
    for (let index = 0; index < rangeEnd; index += 1) {
      expect(editedRuns.some((run) => run.start <= index && run.end > index && run.style.italic)).toBe(true)
    }
    expect(editedRuns.some((run) => run.start <= rangeEnd && run.end > rangeEnd && run.style.italic)).toBe(false)
    expect(flowDocument().revision).toBe(revisionBeforeRangeFormat)

    useEditorStore.setState({
      flowTextEdit: {
        ...useEditorStore.getState().flowTextEdit!,
        range: { start: 1, end: 1 },
      },
    })
    cleanup()
    render(<PropertiesTab onReplaceImage={() => undefined} />)
    expect(screen.getByTestId('flow-selection-format-title')).toHaveTextContent('插入点格式')
    expect(screen.getByTestId('flow-selection-format-hint')).toHaveTextContent('选择文字后应用')
    expect(screen.getByRole('combobox', { name: '字体' })).toHaveValue('KaiTi')
    expect(screen.getByTestId('flow-format-bold')).toBeDisabled()
  })

  it('converts paragraph to quote block via block type dropdown in properties tab', () => {
    useEditorStore.getState().createNewFlowProject()
    const paragraph = flowSurface().blocks.find((block) => block.type === 'paragraph')
    expect(paragraph && paragraph.type === 'paragraph').toBe(true)
    const flow = useEditorStore.getState().flowSession
    if (!flow || !paragraph) throw new Error('expected flow paragraph')
    useEditorStore.setState({
      flowSession: {
        ...flow,
        selection: selectFlowEditorBlocks(flow.history.present, flow.selection.locationId, [paragraph.id]),
      },
    })

    cleanup()
    render(<PropertiesTab onReplaceImage={() => undefined} />)
    const blockTypeContainer = screen.getByTestId('flow-block-type')
    const select = blockTypeContainer.querySelector('select')
    if (!select) throw new Error('expected select inside flow-block-type')
    fireEvent.change(select, { target: { value: 'quote' } })

    const updated = findFlowBlockRecursive(flowSurface().blocks, paragraph.id)
    expect(updated?.block.type).toBe('quote')
  })

  it('converts media block to viewport-overlay when clicking to-overlay button', () => {
    useEditorStore.getState().createNewFlowProject()
    const asset = imageAsset()
    useEditorStore.getState().importAsset(asset, PNG)
    const flow = useEditorStore.getState().flowSession
    if (!flow) throw new Error('expected flow session')
    useEditorStore.getState().applyFlowCommand(insertFlowEditorBlock(flow.history.present, {
      surfaceId: flow.selection.surfaceId,
      parentId: null,
      index: flowSurfaceIn(flow.history.present, flow.selection.surfaceId).blocks.length,
      block: { type: 'media', mediaKind: 'image', assetId: asset.id, layout: 'content-width' },
    }, { expectedRevision: flow.history.present.revision }))

    const mediaBlock = flowSurface().blocks.find((block) => block.type === 'media')
    if (!mediaBlock) throw new Error('expected media block')
    const activeFlow = useEditorStore.getState().flowSession!
    useEditorStore.setState({
      flowSession: {
        ...activeFlow,
        selection: selectFlowEditorBlocks(activeFlow.history.present, activeFlow.selection.locationId, [mediaBlock.id]),
      },
    })

    cleanup()
    render(<PropertiesTab onReplaceImage={() => undefined} />)
    const toOverlayButton = screen.getByTestId('flow-block-to-overlay')
    fireEvent.click(toOverlayButton)

    const updatedFlow = useEditorStore.getState().flowSession!
    const overlayId = updatedFlow.selection.selectedOverlayIds[0]
    expect(overlayId).toBeDefined()
    expect(readFlowSharedOwnership(updatedFlow.history.present, overlayId!)).toBe('viewport-overlay')
    expect(locateCourseLayer(updatedFlow.history.present, overlayId!)?.item.paperSpace).toBe('paper')

    cleanup()
    render(<PropertiesTab onReplaceImage={() => undefined} />)
    const paperSpace = screen.getByTestId('flow-overlay-paper-space').querySelector('select')
    if (!paperSpace) throw new Error('expected paperSpace select')
    fireEvent.change(paperSpace, { target: { value: 'viewport' } })
    expect(locateCourseLayer(useEditorStore.getState().flowSession!.history.present, overlayId!)?.item.paperSpace).toBeUndefined()
  })

  it('updates paragraph fontFamily via FontFamilyPicker and fontSize via input', () => {
    useEditorStore.getState().createNewFlowProject()
    const surface = flowSurface()
    const paragraph = surface.blocks.find((block) => block.type === 'paragraph')
    if (!paragraph || paragraph.type !== 'paragraph') throw new Error('expected paragraph')
    const flow = useEditorStore.getState().flowSession
    if (!flow) throw new Error('expected flow session')

    useEditorStore.getState().applyFlowCommand(updateFlowEditorBlock(flow.history.present, {
      surfaceId: surface.id,
      blockId: paragraph.id,
      parentId: null,
    }, { text: '测试段落内容' }, { expectedRevision: flow.history.present.revision }))

    useEditorStore.setState({
      flowSession: {
        ...useEditorStore.getState().flowSession!,
        selection: selectFlowEditorBlocks(useEditorStore.getState().flowSession!.history.present, flow.selection.locationId, [paragraph.id]),
      },
    })

    cleanup()
    render(<PropertiesTab onReplaceImage={() => undefined} />)

    const fontPickerInput = screen.getByRole('combobox', { name: '字体' }) as HTMLInputElement
    fireEvent.focus(fontPickerInput)
    fireEvent.change(fontPickerInput, { target: { value: 'KaiTi' } })
    fireEvent.blur(fontPickerInput)

    const fontSizeContainer = screen.getByTestId('flow-font-size')
    const fontSizeInput = fontSizeContainer.querySelector('input')
    if (!fontSizeInput) throw new Error('expected font size input')
    fireEvent.change(fontSizeInput, { target: { value: '24' } })
    fireEvent.blur(fontSizeInput)

    const updated = findFlowBlockRecursive(flowSurface().blocks, paragraph.id)
    expect(updated?.block.type).toBe('paragraph')
    const pBlock = updated?.block as typeof paragraph
    expect(pBlock.runs?.some((run) => run.style.fontFamily === 'KaiTi' && run.style.fontSize === 24)).toBe(true)
  })

  it('stores textAlign and lineSpacing on paragraph block (not on runs)', () => {
    useEditorStore.getState().createNewFlowProject()
    const surface = flowSurface()
    const paragraph = surface.blocks.find((block) => block.type === 'paragraph')
    if (!paragraph || paragraph.type !== 'paragraph') throw new Error('expected paragraph')
    const flow = useEditorStore.getState().flowSession
    if (!flow) throw new Error('expected flow session')

    useEditorStore.setState({
      flowSession: {
        ...flow,
        selection: selectFlowEditorBlocks(flow.history.present, flow.selection.locationId, [paragraph.id]),
      },
    })

    cleanup()
    render(<PropertiesTab onReplaceImage={() => undefined} />)

    const alignContainer = screen.getByTestId('flow-block-align')
    const alignSelect = alignContainer.querySelector('select')
    if (!alignSelect) throw new Error('expected align select')
    fireEvent.change(alignSelect, { target: { value: 'center' } })

    const lineSpacingContainer = screen.getByTestId('flow-block-line-spacing')
    const lineSpacingInput = lineSpacingContainer.querySelector('input')
    if (!lineSpacingInput) throw new Error('expected line spacing input')
    fireEvent.change(lineSpacingInput, { target: { value: '16' } })
    fireEvent.blur(lineSpacingInput)

    const updated = findFlowBlockRecursive(flowSurface().blocks, paragraph.id)
    expect(updated?.block.type).toBe('paragraph')
    const pBlock = updated?.block as typeof paragraph & { textAlign?: string; lineSpacing?: number }
    expect(pBlock.textAlign).toBe('center')
    expect(pBlock.lineSpacing).toBe(16)
    if (pBlock.runs) {
      for (const run of pBlock.runs) {
        expect((run.style as Record<string, unknown>).textAlign).toBeUndefined()
        expect((run.style as Record<string, unknown>).lineSpacing).toBeUndefined()
      }
    }
  })

  it('buildFlowRichTextHtml renders font-family and font-size correctly', () => {
    const html = buildFlowRichTextHtml('A', [{
      start: 0,
      end: 1,
      style: { fontFamily: 'serif', fontSize: 20 },
    }])
    expect(html).toContain('font-family:serif')
    expect(html).toContain('font-size:20px')
  })
})
