import { describe, expect, it } from 'vitest'
import { makeAuthoringAddress } from '@/shared/authoringAddress'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import {
  COURSE_PROJECT_SCHEMA_VERSION,
  type CourseProjectDocument,
  type FlowBlock,
} from '@/shared/courseProjectTypes'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import { createTextNode } from '@/renderer/project/createProject'
import {
  applyFlowCommittedText,
  copyFlowEditorBlocks,
  createBlankFlowPageBlocks,
  createBlankFlowSurface,
  cutFlowEditorBlocks,
  deleteFlowEditorBlock,
  deleteFlowEditorBlocks,
  duplicateFlowEditorBlock,
  executeFlowDelete,
  executeFlowEditorCommand,
  formatFlowEditorBlock,
  indentFlowEditorBlock,
  insertFlowEditorBlock,
  mergeFlowEditorBlock,
  moveFlowEditorBlock,
  outdentFlowEditorBlock,
  pasteFlowEditorBlocks,
  reorderFlowEditorBlock,
  splitFlowEditorBlock,
  updateFlowEditorBlock,
  FLOW_GLOBAL_STRUCTURE_REASON,
  FLOW_LAST_HEADING_REASON,
  FLOW_LAST_LOCATION_REASON,
  BLANK_FLOW_HEADING_PLACEHOLDER,
} from '@/renderer/course/flowEditorCommands'
import {
  commitFlowEditorHistory,
  createFlowEditorHistory,
  redoFlowEditorHistory,
  selectFlowEditorBlock,
  selectFlowEditorBlocks,
  selectFlowGlobalScope,
  selectFlowOverlay,
  undoFlowEditorHistory,
  enterFlowTextEditing,
} from '@/renderer/course/flowEditorSlice'
import { syncFlowCourseLocations } from '@/renderer/course/flowDocumentModel'

const NOW = '2026-08-17T09:00:00.000Z'

function courseShell(): Omit<CourseProjectDocument, 'locations' | 'startLocationId' | 'surfaces'> {
  return {
    schemaVersion: COURSE_PROJECT_SCHEMA_VERSION,
    id: 'flow-commands',
    revision: 0,
    title: 'Flow 命令',
    createdAt: NOW,
    updatedAt: NOW,
    assets: {
      'asset-image': {
        id: 'asset-image',
        filename: 'cover.png',
        mimeType: 'image/png',
        kind: 'image',
        path: 'media/cover.png',
        byteLength: 1024,
        width: 640,
        height: 360,
      },
    },
    componentPackages: {},
    designTokens: {
      fonts: [{
        id: 'body',
        label: '正文',
        fontFamily: '"Microsoft YaHei", "PingFang SC", sans-serif',
      }],
      colors: [
        { id: 'background', label: '背景', color: '#ffffff' },
        { id: 'text', label: '正文', color: '#1f2937' },
      ],
    },
    media: {
      audio: {
        defaultMuted: false,
        masterVolume: 1,
        channelVolumes: { music: 1, narration: 1, sfx: 1, ui: 1, video: 1 },
        sounds: {},
        narrationDucking: { enabled: true, musicVolume: 0.3, fadeMs: 250 },
      },
    },
    playback: {
      controls: 'none',
      keyboardNavigation: true,
      presenter: { enabled: true, strategy: 'scene-navigation', additionalBindings: [] },
    },
    courseState: [],
    navigationGuards: [],
    globalLayerItems: [],
    globalInteractions: [],
  }
}

function overlayItem(id: string, order: number, locked = false) {
  return {
    item: sceneNodeToCourseLayerItem(createTextNode({
      id,
      name: '浮层文字',
      text: '浮层',
      locked,
    }), order),
    visibility: { mode: 'all' as const, locationIds: [] },
  }
}

function createFlowProject(): CourseProjectDocument {
  const blocks: FlowBlock[] = [
    { id: 'h1', type: 'heading', level: 1, text: '标题一' },
    {
      id: 'p-runs',
      type: 'paragraph',
      text: '加粗段落',
      runs: [{ start: 0, end: 2, style: { bold: true } }],
    },
    {
      id: 'top-list',
      type: 'list',
      ordered: false,
      items: [{ id: 'item-1', text: '第一项' }],
    },
    {
      id: 'media-1',
      type: 'media',
      assetId: 'asset-image',
      mediaKind: 'image',
      altText: '示意图',
      caption: '封面图',
      layout: 'content-width',
    },
    {
      id: 'sec-1',
      type: 'section',
      title: '第一节',
      collapsedByDefault: false,
      blocks: [
        { id: 'nested-h', type: 'heading', level: 2, text: '小节' },
        { id: 'nested-a', type: 'paragraph', text: '嵌套段落 A' },
      ],
    },
    {
      id: 'sec-2',
      type: 'section',
      title: '第二节',
      collapsedByDefault: false,
      blocks: [{ id: 'nested-b', type: 'paragraph', text: '嵌套段落 B' }],
    },
  ]
  const project: CourseProjectDocument = {
    ...courseShell(),
    locations: [{
      id: 'h1',
      label: '标题一',
      kind: 'flow-block',
      surfaceId: 'flow',
      blockId: 'h1',
    }],
    startLocationId: 'h1',
    surfaces: [{
      id: 'flow',
      type: 'flow',
      title: '讲义',
      layout: { readingWidth: 760, wideContentWidth: 1120 },
      surfaceLayerItems: [overlayItem('overlay-text', 20)],
      blocks,
    }],
  }
  syncFlowCourseLocations(project, 'flow')
  return courseProjectDocumentSchema.parse(project)
}

function flowOf(project: CourseProjectDocument) {
  const surface = project.surfaces.find((candidate) => candidate.id === 'flow')
  if (!surface || surface.type !== 'flow') throw new Error('expected flow surface')
  return surface
}

function expectHistory(result: { ok: boolean; historyEntry?: boolean; nextDocument?: CourseProjectDocument }) {
  expect(result.ok).toBe(true)
  expect(result.historyEntry).toBe(true)
  expect(result.nextDocument).toBeDefined()
  expect(courseProjectDocumentSchema.parse(result.nextDocument)).toEqual(result.nextDocument)
}

function target(blockId: string, parentId: string | null = null) {
  return { surfaceId: 'flow', blockId, parentId }
}

describe('Flow editor commands', () => {
  it('creates a blank page as H1 plus empty paragraph, and only the heading is a course location', () => {
    const [heading, paragraph] = createBlankFlowPageBlocks({
      headingId: 'blank-h',
      paragraphId: 'blank-p',
    })
    expect(heading).toMatchObject({
      type: 'heading',
      level: 1,
      text: BLANK_FLOW_HEADING_PLACEHOLDER,
    })
    expect(paragraph).toMatchObject({ type: 'paragraph', text: '' })
    const blank = createBlankFlowSurface({
      id: 'flow-blank',
      title: '空白讲义',
      headingId: 'blank-h',
      paragraphId: 'blank-p',
    })
    const project: CourseProjectDocument = {
      ...courseShell(),
      id: 'blank-flow',
      locations: [blank.location],
      startLocationId: blank.location.id,
      surfaces: [blank.surface],
    }
    const parsed = courseProjectDocumentSchema.parse(project)
    expect(parsed.locations).toEqual([expect.objectContaining({
      kind: 'flow-block',
      blockId: 'blank-h',
    })])
    expect(parsed.locations.some((location) =>
      location.kind === 'flow-block' && location.blockId === 'blank-p',
    )).toBe(false)
  })

  it('inserts blocks with one history each and does not promote ordinary blocks to locations', () => {
    const project = createFlowProject()
    const inserted = insertFlowEditorBlock(project, {
      surfaceId: 'flow',
      parentId: null,
      index: 1,
      block: { type: 'paragraph', text: '普通段落' },
    }, { now: NOW })
    expectHistory(inserted)
    expect(inserted.nextDocument!.revision).toBe(project.revision + 1)
    expect(inserted.nextDocument!.locations.some((location) =>
      location.kind === 'flow-block' && location.blockId === inserted.createdBlockIds?.[0],
    )).toBe(false)

    const heading = insertFlowEditorBlock(inserted.nextDocument!, {
      surfaceId: 'flow',
      parentId: null,
      index: 0,
      block: { id: 'anchor-h', type: 'heading', level: 2, text: '目录标题' },
    }, { now: NOW, expectedRevision: inserted.nextDocument!.revision })
    expectHistory(heading)
    expect(heading.nextDocument!.locations.some((location) =>
      location.kind === 'flow-block' && location.blockId === 'anchor-h',
    )).toBe(true)
    expect(heading.nextDocument!.revision).toBe(project.revision + 2)
  })

  it('applies committed text + runs without a second draft structure', () => {
    const project = createFlowProject()
    const result = applyFlowCommittedText(project, target('p-runs'), '加粗段落已改', {
      now: NOW,
      runs: [{ start: 0, end: 2, style: { bold: true, italic: true } }],
    })
    expectHistory(result)
    const paragraph = flowOf(result.nextDocument!).blocks.find((block) => block.id === 'p-runs')
    expect(paragraph).toMatchObject({
      type: 'paragraph',
      text: '加粗段落已改',
      runs: [{ start: 0, end: 2, style: { bold: true, italic: true } }],
    })
  })

  it('splits, formats, and merges rich text with one history each', () => {
    const project = createFlowProject()
    const split = splitFlowEditorBlock(project, target('p-runs'), 2, { now: NOW })
    expectHistory(split)
    const afterSplit = flowOf(split.nextDocument!).blocks
    const left = afterSplit.find((block) => block.id === 'p-runs')
    const right = afterSplit[afterSplit.findIndex((block) => block.id === 'p-runs') + 1]
    expect(left).toMatchObject({ type: 'paragraph', text: '加粗' })
    expect(right).toMatchObject({ type: 'paragraph', text: '段落' })
    expect(split.nextDocument!.locations.some((location) =>
      location.kind === 'flow-block' && location.blockId === right!.id,
    )).toBe(false)

    const formatted = formatFlowEditorBlock(split.nextDocument!, target('p-runs'), {
      kind: 'text-style',
      style: { italic: true },
      range: 'all',
    }, { now: NOW, expectedRevision: split.nextDocument!.revision })
    expectHistory(formatted)
    const styled = flowOf(formatted.nextDocument!).blocks.find((block) => block.id === 'p-runs')
    expect(styled?.type === 'paragraph' ? styled.runs : undefined).toEqual(
      expect.arrayContaining([expect.objectContaining({ style: expect.objectContaining({ italic: true }) })]),
    )

    const merged = mergeFlowEditorBlock(
      formatted.nextDocument!,
      target(right!.id),
      { now: NOW, expectedRevision: formatted.nextDocument!.revision },
    )
    expectHistory(merged)
    const restored = flowOf(merged.nextDocument!).blocks.find((block) => block.id === 'p-runs')
    expect(restored).toMatchObject({ type: 'paragraph', text: '加粗段落' })
  })

  it('moves, indents, outdents and reorders with one history each', () => {
    const project = createFlowProject()
    const moved = moveFlowEditorBlock(project, target('p-runs'), { parentId: 'sec-2', index: 0 }, { now: NOW })
    expectHistory(moved)
    expect(flowOf(moved.nextDocument!).blocks.map((block) => block.id)).not.toContain('p-runs')
    const indented = indentFlowEditorBlock(moved.nextDocument!, target('sec-2'), {
      now: NOW,
      expectedRevision: moved.nextDocument!.revision,
    })
    expectHistory(indented)
    const sec1 = flowOf(indented.nextDocument!).blocks.find((block) => block.id === 'sec-1')
    expect(sec1?.type === 'section' ? sec1.blocks.map((block) => block.id) : []).toContain('sec-2')
    const outdented = outdentFlowEditorBlock(indented.nextDocument!, target('sec-2', 'sec-1'), {
      now: NOW,
      expectedRevision: indented.nextDocument!.revision,
    })
    expectHistory(outdented)
    expect(flowOf(outdented.nextDocument!).blocks.map((block) => block.id)).toContain('sec-2')
    const reordered = reorderFlowEditorBlock(outdented.nextDocument!, target('top-list'), 0, {
      now: NOW,
      expectedRevision: outdented.nextDocument!.revision,
    })
    expectHistory(reordered)
    expect(flowOf(reordered.nextDocument!).blocks[0]?.id).toBe('top-list')
  })

  it('separates Delete semantics for text, block and overlay focus', () => {
    const project = createFlowProject()
    const textSelection = enterFlowTextEditing(
      project,
      selectFlowEditorBlock(project, 'h1', 'p-runs'),
      { blockId: 'p-runs', start: 0, end: 2 },
    )
    const textDeleted = executeFlowDelete(project, textSelection, { now: NOW })
    expectHistory(textDeleted)
    const paragraph = flowOf(textDeleted.nextDocument!).blocks.find((block) => block.id === 'p-runs')
    expect(paragraph).toMatchObject({ type: 'paragraph', text: '段落' })
    expect(flowOf(textDeleted.nextDocument!).blocks.some((block) => block.id === 'p-runs')).toBe(true)

    const blockSelection = selectFlowEditorBlock(project, 'h1', 'top-list')
    const blockDeleted = executeFlowDelete(project, blockSelection, { now: NOW })
    expectHistory(blockDeleted)
    expect(flowOf(blockDeleted.nextDocument!).blocks.some((block) => block.id === 'top-list')).toBe(false)

    const overlaySelection = selectFlowOverlay(project, 'h1', ['overlay-text'])
    const overlayDeleted = executeFlowDelete(project, overlaySelection, { now: NOW })
    expectHistory(overlayDeleted)
    expect(flowOf(overlayDeleted.nextDocument!).surfaceLayerItems).toEqual([])
    expect(flowOf(overlayDeleted.nextDocument!).blocks.some((block) => block.id === 'h1')).toBe(true)
  })

  it('refuses structure commands in global scope and does not delete the last heading', () => {
    const project = createFlowProject()
    const global = selectFlowGlobalScope(project, 'h1', 'overlay-text')
    const blocked = executeFlowEditorCommand(project, global, {
      name: 'insert',
      input: {
        surfaceId: 'flow',
        parentId: null,
        index: 0,
        block: { type: 'paragraph', text: '不应出现' },
      },
    }, { now: NOW })
    expect(blocked).toMatchObject({ ok: false, reason: FLOW_GLOBAL_STRUCTURE_REASON })
    expect(blocked.historyEntry).toBe(false)

    const headingIds = project.locations
      .filter((location) => location.kind === 'flow-block')
      .map((location) => target(
        location.blockId,
        location.blockId === 'nested-h' ? 'sec-1' : location.blockId === 'sec-1' || location.blockId === 'sec-2'
          ? null
          : null,
      ))
    const wipe = deleteFlowEditorBlocks(project, headingIds, { now: NOW })
    expect(wipe.ok).toBe(false)
    expect(wipe.reason === FLOW_LAST_HEADING_REASON || wipe.reason === FLOW_LAST_LOCATION_REASON).toBe(true)
  })

  it('cut/copy/paste/duplicate keep structure and asset references, regenerating ids', () => {
    const project = createFlowProject()
    const copied = copyFlowEditorBlocks(project, [target('media-1')])
    expect(copied.ok).toBe(true)
    expect(copied.historyEntry).toBe(false)
    expect(copied.clipboard?.[0]).toMatchObject({ type: 'media', assetId: 'asset-image', id: 'media-1' })

    const pasted = pasteFlowEditorBlocks(project, {
      surfaceId: 'flow',
      parentId: null,
      index: 2,
      blocks: copied.clipboard!,
    }, { now: NOW })
    expectHistory(pasted)
    const clones = flowOf(pasted.nextDocument!).blocks.filter((block) =>
      block.type === 'media' && block.id !== 'media-1',
    )
    expect(clones).toHaveLength(1)
    expect(clones[0]).toMatchObject({ type: 'media', assetId: 'asset-image' })
    expect(clones[0]!.id).not.toBe('media-1')
    expect(pasted.nextDocument!.locations.some((location) =>
      location.kind === 'flow-block' && location.blockId === clones[0]!.id,
    )).toBe(false)

    const duplicated = duplicateFlowEditorBlock(project, target('top-list'), { now: NOW })
    expectHistory(duplicated)
    const listCopy = flowOf(duplicated.nextDocument!).blocks[
      flowOf(duplicated.nextDocument!).blocks.findIndex((block) => block.id === 'top-list') + 1
    ]
    expect(listCopy?.type === 'list' ? listCopy.items.map((item) => item.id) : []).not.toContain('item-1')

    const cut = cutFlowEditorBlocks(project, [target('p-runs')], { now: NOW })
    expectHistory(cut)
    expect(cut.clipboard?.[0]).toMatchObject({ id: 'p-runs', type: 'paragraph' })
    expect(flowOf(cut.nextDocument!).blocks.some((block) => block.id === 'p-runs')).toBe(false)
    expect(cut.nextDocument!.locations.some((location) =>
      location.kind === 'flow-block' && location.blockId === 'p-runs',
    )).toBe(false)
  })

  it('keeps ids stable across JSON round-trip and one history per command', () => {
    const project = createFlowProject()
    let history = createFlowEditorHistory(project)
    const commands = [
      (doc: CourseProjectDocument) => insertFlowEditorBlock(doc, {
        surfaceId: 'flow',
        parentId: null,
        index: 0,
        block: { id: 'stable-block', type: 'paragraph', text: '稳定块' },
      }, { now: NOW }),
      (doc: CourseProjectDocument) => updateFlowEditorBlock(doc, target('p-runs'), {
        text: '一次更新',
      }, { now: NOW }),
      (doc: CourseProjectDocument) => duplicateFlowEditorBlock(doc, target('top-list'), { now: NOW }),
    ]
    for (const run of commands) {
      const result = run(history.present)
      expectHistory(result)
      history = commitFlowEditorHistory(history, result.nextDocument!)
    }
    expect(history.past).toHaveLength(3)
    expect(history.present.revision).toBe(project.revision + 3)

    const reopened = courseProjectDocumentSchema.parse(JSON.parse(JSON.stringify(history.present)))
    expect(reopened).toEqual(history.present)
    expect(flowOf(reopened).blocks.some((block) => block.id === 'stable-block')).toBe(true)
    expect(makeAuthoringAddress({
      projectId: reopened.id,
      scope: 'surface',
      surfaceId: 'flow',
      carrier: 'native',
      layerItemId: 'stable-block',
      field: 'block',
    })).toContain('courseware://authoring/')
    expect(makeAuthoringAddress({
      projectId: reopened.id,
      scope: 'surface',
      surfaceId: 'flow',
      carrier: 'native',
      layerItemId: 'stable-block',
      field: 'block',
    })).not.toContain('hitId')

    let undone = history
    undone = undoFlowEditorHistory(undone)
    undone = undoFlowEditorHistory(undone)
    undone = undoFlowEditorHistory(undone)
    expect(flowOf(undone.present).blocks.some((block) => block.id === 'stable-block')).toBe(false)
    const redone = redoFlowEditorHistory(undone)
    expect(flowOf(redone.present).blocks.some((block) => block.id === 'stable-block')).toBe(true)
  })

  it('rejects stale revision and stale parent targets without writing history', () => {
    const project = createFlowProject()
    const stale = deleteFlowEditorBlock(project, target('nested-a'), { now: NOW, expectedRevision: 99 })
    expect(stale).toMatchObject({ ok: false, reason: 'stale-revision', historyEntry: false })
    const wrongParent = deleteFlowEditorBlock(project, target('nested-a'), { now: NOW })
    expect(wrongParent.ok).toBe(false)
    expect(wrongParent.reason).toContain('所选 Flow 块位置已变化')
  })

  it('uses the frozen selection/command dispatcher for paper double-click and range format', () => {
    const project = createFlowProject()
    const selection = selectFlowEditorBlocks(project, 'h1', ['p-runs'], {
      focus: 'text',
      textRange: { blockId: 'p-runs', start: 0, end: 2 },
    })
    expect(selection).toMatchObject({
      locationId: 'h1',
      surfaceId: 'flow',
      authoringScope: 'page',
      focus: 'text',
      selectedBlockIds: ['p-runs'],
      selectedOverlayIds: [],
    })
    expect(selection.authoringAddress).toBe(makeAuthoringAddress({
      projectId: project.id,
      scope: 'surface',
      surfaceId: 'flow',
      carrier: 'native',
      layerItemId: 'p-runs',
      field: 'text',
    }))
    const formatted = executeFlowEditorCommand(project, selection, {
      name: 'format',
      spec: { kind: 'text-style', style: { color: '#ff0000' } },
    }, { now: NOW })
    expectHistory(formatted)
    const paragraph = flowOf(formatted.nextDocument!).blocks.find((block) => block.id === 'p-runs')
    expect(paragraph?.type === 'paragraph' ? paragraph.runs : undefined).toEqual(
      expect.arrayContaining([expect.objectContaining({
        start: 0,
        end: 2,
        style: expect.objectContaining({ color: '#ff0000' }),
      })]),
    )
  })

  it('converts paragraph to quote while preserving id, text, and runs', () => {
    const project = createFlowProject()
    const selection = selectFlowEditorBlocks(project, 'h1', ['p-runs'])
    const result = executeFlowEditorCommand(project, selection, {
      name: 'format',
      spec: { kind: 'convert-quote' },
    }, { now: NOW })
    expectHistory(result)
    const converted = flowOf(result.nextDocument!).blocks.find((block) => block.id === 'p-runs')
    expect(converted).toMatchObject({
      id: 'p-runs',
      type: 'quote',
      text: '加粗段落',
      runs: [{ start: 0, end: 2, style: { bold: true } }],
    })
  })

  it('refuses converting last navigable heading to quote with FLOW_LAST_HEADING_REASON', () => {
    const project = createFlowProject()
    // createFlowProject has headings: h1 (level 1) and nested-h (inside sec-1) and sec-1/sec-2 sections
    // Remove sec-1 and sec-2 so h1 is the only anchor
    const singleAnchorProject: CourseProjectDocument = {
      ...project,
      surfaces: project.surfaces.map((s) => ({
        ...s,
        blocks: s.blocks.filter((b) => b.type !== 'section'),
      })),
    }

    const h1Selection = selectFlowEditorBlocks(singleAnchorProject, 'h1', ['h1'])
    const result = executeFlowEditorCommand(singleAnchorProject, h1Selection, {
      name: 'format',
      spec: { kind: 'convert-quote' },
    }, { now: NOW })
    expect(result.ok).toBe(false)
    expect(result.reason).toContain('至少需要一个可导航标题')
  })
})
