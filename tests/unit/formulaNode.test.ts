import { beforeEach, describe, expect, it, vi } from 'vitest'
import { buildPublishedCourseV2Payload } from '@/renderer/export/course/buildPublishedCourse'
import { collectCourseProjectExportPreflight } from '@/renderer/export/exportPreflight'
import { createFormulaNode, type FormulaNodeOptions } from '@/renderer/project/nativeNodeFactories'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import {
  createCourseProjectArchive,
  openCourseProjectArchive,
} from '@/renderer/project/courseProjectArchive'
import {
  selectActiveScene,
  useEditorStore,
  selectActiveCourseProjectDocument,
} from '@/renderer/store/editorStore'
import { materializeScene } from '@/shared/presentation'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type { CourseProjectDocument, NativeLayerItem } from '@/shared/courseProjectTypes'
import { formulaAstSchema } from '@/shared/contracts/native-v1/schema'
import type { FormulaAstNode } from '@/shared/projectTypes'

function materialized(
  scene: object,
  stateId?: string | null,
) {
  return materializeScene(scene as Parameters<typeof materializeScene>[0], stateId)
}

const completeAst: FormulaAstNode = {
  type: 'row',
  children: [
    {
      type: 'fenced',
      open: '(',
      close: ')',
      body: {
        type: 'fraction',
        numerator: {
          type: 'root',
          index: { type: 'token', value: '3' },
          radicand: { type: 'token', value: 'x' },
        },
        denominator: {
          type: 'script',
          base: { type: 'token', value: 'y' },
          superscript: { type: 'token', value: '2' },
          subscript: { type: 'token', value: 'i' },
        },
      },
    },
    { type: 'operator', value: '=' },
    { type: 'token', value: '1' },
  ],
}

function measuringContext(): CanvasRenderingContext2D {
  return {
    measureText: vi.fn((value: string) => ({
      width: Math.max(8, Array.from(value).length * 12),
    })),
  } as unknown as CanvasRenderingContext2D
}

function blankSlideProject(): CourseProjectDocument {
  return createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
}

function slideScene(project: CourseProjectDocument) {
  const surface = project.surfaces[0]
  if (!surface || surface.type !== 'slide') throw new Error('expected slide surface')
  const scene = surface.scenes[0]
  if (!scene) throw new Error('expected slide scene')
  return scene
}

type FormulaLayerItem = NativeLayerItem & {
  kind: 'native'
  content: Extract<NativeLayerItem['content'], { nativeType: 'formula' }>
}

function addFormulaLayer(
  project: CourseProjectDocument,
  options: FormulaNodeOptions,
): FormulaLayerItem {
  const item = sceneNodeToCourseLayerItem(
    createFormulaNode(options),
    slideScene(project).layerItems.length,
  )
  if (item.kind !== 'native' || item.content.nativeType !== 'formula') {
    throw new Error('expected formula layer item')
  }
  slideScene(project).layerItems.push(item)
  return item as FormulaLayerItem
}

function publishedFormula(project: CourseProjectDocument) {
  const published = buildPublishedCourseV2Payload({
    project,
    assetFiles: {},
    components: {},
  })
  const surface = published.surfaces[0]
  if (!surface || surface.type !== 'slide') throw new Error('expected published slide')
  const item = surface.scenes[0]!.layerItems[0]
  if (!item || item.kind !== 'native' || item.content.nativeType !== 'formula') {
    throw new Error('expected published formula')
  }
  return item.content.data
}

beforeEach(() => {
  useEditorStore.getState().createNewProject()
  vi.restoreAllMocks()
})

describe('Course Project V9 FormulaNode contract', () => {
  it('accepts every minimum AST kind and rejects semantically empty scripts', () => {
    expect(formulaAstSchema.parse(completeAst)).toEqual(completeAst)
    expect(formulaAstSchema.safeParse({
      type: 'script',
      base: { type: 'token', value: 'x' },
    }).success).toBe(false)

    const project = blankSlideProject()
    addFormulaLayer(project, {
      id: 'formula-node-1',
      formulaId: 'lesson.quadratic:answer-1',
      accessibleText: '三次根号 x 除以 y 的平方下标 i，等于一',
      ast: completeAst,
      style: { fontSize: 52, color: '#123456', align: 'right' },
    })
    expect(courseProjectDocumentSchema.safeParse(project).success).toBe(true)

    const invalid = structuredClone(project)
    const node = slideScene(invalid).layerItems[0]
    if (!node || node.kind !== 'native' || node.content.nativeType !== 'formula') {
      throw new Error('Expected FormulaNode')
    }
    node.content.data.ast = {
      type: 'script',
      base: { type: 'token', value: 'x' },
    }
    const result = courseProjectDocumentSchema.safeParse(invalid)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues.some(({ message }) => (
        message.includes('superscript') || message.includes('subscript')
      ))).toBe(true)
    }
  })

  it('preserves semantic identity through archive and Published Course V2 round trips', () => {
    const project = blankSlideProject()
    const formula = addFormulaLayer(project, {
      id: 'formula-node-roundtrip',
      formulaId: 'math.energy.conservation',
      accessibleText: 'E 等于 m c 的平方',
      ast: completeAst,
    })

    const archive = createCourseProjectArchive({
      project,
      assetFiles: {},
      componentFiles: {},
    })
    const reopened = openCourseProjectArchive(archive).project
    const restoredItem = slideScene(reopened).layerItems[0]
    expect(restoredItem).toMatchObject({
      kind: 'native',
      content: {
        nativeType: 'formula',
        data: {
          formulaId: formula.content.data.formulaId,
          accessibleText: formula.content.data.accessibleText,
          ast: completeAst,
        },
      },
    })

    expect(publishedFormula(reopened)).toMatchObject({
      formulaId: formula.content.data.formulaId,
      accessibleText: formula.content.data.accessibleText,
      ast: completeAst,
    })
    expect(courseProjectDocumentSchema.safeParse(reopened).success).toBe(true)
  })

  it('uses the normal state-override and undo/redo command path', () => {
    const store = useEditorStore.getState()
    store.addFormulaNode(160, 120)
    const formula = selectActiveScene(useEditorStore.getState()).nodes[0]
    if (formula?.type !== 'formula') throw new Error('Expected FormulaNode')
    const formulaId = formula.formulaId
    store.addPresentationState('公式答案')
    const stateId = useEditorStore.getState().activePresentationStateId!
    const historyBefore = useEditorStore.getState().history.past.length

    useEditorStore.getState().updateNode(formula.id, {
      accessibleText: '答案为一',
      ast: { type: 'token', value: '1' },
      style: { fontSize: 64, color: '#7c3aed', align: 'right' },
    })

    let scene = selectActiveScene(useEditorStore.getState())
    expect(scene.nodes[0]).toMatchObject({
      type: 'formula',
      formulaId,
      accessibleText: 'x 的平方加二分之一',
    })
    expect(materialized(scene, stateId).nodes[0]).toMatchObject({
      type: 'formula',
      formulaId,
      accessibleText: '答案为一',
      ast: { type: 'token', value: '1' },
      style: { fontSize: 64, color: '#7c3aed', align: 'right' },
    })
    expect(useEditorStore.getState().history.past).toHaveLength(historyBefore + 1)

    useEditorStore.getState().undo()
    scene = selectActiveScene(useEditorStore.getState())
    expect(materialized(scene, stateId).nodes[0]).toMatchObject({
      accessibleText: 'x 的平方加二分之一',
    })
    useEditorStore.getState().redo()
    scene = selectActiveScene(useEditorStore.getState())
    expect(materialized(scene, stateId).nodes[0]).toMatchObject({
      accessibleText: '答案为一',
      formulaId,
    })
    expect(courseProjectDocumentSchema.safeParse(selectActiveCourseProjectDocument(useEditorStore.getState())!).success)
      .toBe(true)
  })

  it('reports clipping and explains PPTX staticization without blocking a fitting formula', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      measuringContext(),
    )
    const project = blankSlideProject()
    const fitting = addFormulaLayer(project, {
      id: 'formula-fitting',
      formulaId: 'formula.fitting',
      width: 500,
      height: 200,
      ast: { type: 'token', value: 'x' },
    })
    const clipped = addFormulaLayer(project, {
      id: 'formula-clipped',
      formulaId: 'formula.clipped',
      width: 24,
      height: 24,
      style: { fontSize: 80 },
      ast: completeAst,
    })

    const report = collectCourseProjectExportPreflight(
      project,
      'pptx',
      { assetFiles: {}, components: {} },
      new Date('2026-08-11T00:00:00.000Z'),
      { playerBundle: '/* player */' },
    )
    expect(report.items).toContainEqual(expect.objectContaining({
      code: 'pptx-formula-rasterized',
      nodeId: fitting.layerItemId,
      severity: 'info',
    }))
    expect(report.items).toContainEqual(expect.objectContaining({
      code: 'formula-content-overflow-estimated',
      nodeId: clipped.layerItemId,
      severity: 'warning',
    }))
    expect(report.summary.canExport).toBe(true)
  })

  it('keeps formula overflow blocking when real browser Canvas metrics are available', () => {
    vi.stubGlobal('navigator', { userAgent: 'Chrome' })
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      measuringContext(),
    )
    const project = blankSlideProject()
    const clipped = addFormulaLayer(project, {
      id: 'formula-browser-clipped',
      width: 24,
      height: 24,
      style: { fontSize: 80 },
      ast: completeAst,
    })

    const report = collectCourseProjectExportPreflight(
      project,
      'pptx',
      { assetFiles: {}, components: {} },
      new Date('2026-08-11T00:00:00.000Z'),
      { playerBundle: '/* player */' },
    )
    expect(report.items).toContainEqual(expect.objectContaining({
      code: 'formula-content-overflow',
      nodeId: clipped.layerItemId,
      severity: 'error',
    }))
    expect(report.summary.canExport).toBe(false)
    vi.unstubAllGlobals()
  })
})
