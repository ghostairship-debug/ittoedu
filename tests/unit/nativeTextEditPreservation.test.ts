import { describe, expect, it } from 'vitest'
import { createBlankCourseProject } from '@/core/course/createCourseProject'
import { createTextNode } from '@/core/tools/nativeNodeFactories'
import { sceneNodeToCourseLayerItem } from '@/shared/courseProjectModel'
import { makeLayerItemAuthoringAddress } from '@/renderer/authoring/courseAuthoringScope'
import { projectEffectiveLayers } from '@/renderer/course/effectiveLayerProjection'
import { nativeAuthoringTool } from '@/renderer/authoring/tools/nativeAuthoringTool'
import { executeAuthoringTool } from '@/renderer/authoring/tools/executeAuthoringTool'
import { applyEditorTransactionStep, type EditorTransactionStep } from '@/renderer/authoring/editorTransaction'
import { createCourseProjectArchive, openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import type { AuthoringToolTargetWireV1 } from '@/shared/authoringToolContract'

describe('Native text edit preservation', () => {
  it('U01-native-roundtrip preserves separated state formatting, siblings, identity, save and history', async () => {
    const project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
    const surface = project.surfaces[0]!
    if (surface.type !== 'slide') throw new Error('expected Slide')
    const scene = surface.scenes[0]!
    const title = sceneNodeToCourseLayerItem(createTextNode({ id: 'title', text: '基础标题' }), 1)
    const sibling = sceneNodeToCourseLayerItem(createTextNode({ id: 'sibling', text: '保持不变' }), 2)
    scene.layerItems.push(title, sibling)
    scene.presentation = {
      initialStateId: 'emphasis',
      states: [{
        id: 'emphasis',
        name: '强调态',
        layerItemOverrides: {
          title: {
            nativeData: {
              text: '旧头强调旧尾',
              runs: [{ start: 2, end: 4, style: { bold: true, highlightColor: '#fff3a3' } }],
            },
          },
        },
      }],
    }
    const locationId = project.startLocationId
    const target: AuthoringToolTargetWireV1 = {
      projectId: project.id,
      documentRevision: project.revision,
      revisionPolicy: { kind: 'exact' },
      sessionGeneration: 1,
      surfaceType: 'slide',
      surfaceId: surface.id,
      locationId,
      stateId: 'emphasis',
      owner: 'scene',
      ownerKey: `scene:${scene.id}`,
      itemId: 'title',
      authoringAddress: makeLayerItemAuthoringAddress({
        projectId: project.id,
        owner: 'scene',
        surfaceId: surface.id,
        sceneId: scene.id,
        kind: 'native',
        layerItemId: 'title',
      }),
    }
    let state = { document: project, resources: { assetFiles: {}, componentPackages: {} } }
    let committed: EditorTransactionStep | undefined
    const receipt = await executeAuthoringTool({
      version: 1,
      requestId: crypto.randomUUID(),
      tool: nativeAuthoringTool.name,
      destination: { kind: 'update', target },
      input: {
        operation: 'edit-text',
        replacements: [
          { original: '旧', replacement: '新', contextAfter: '头' },
          { original: '旧', replacement: '新', contextBefore: '调', contextAfter: '尾' },
        ],
      },
    }, nativeAuthoringTool, {
      readDocument: () => state.document,
      validateDestination: () => null,
      commit(step) {
        committed = step
        state = applyEditorTransactionStep(state, step, 'forward')
        return true
      },
    })

    expect(receipt.status, JSON.stringify(receipt.diagnostics)).toBe('committed')
    expect(state.document.id).toBe(project.id)
    expect(state.document.revision).toBe(project.revision + 1)
    expect(scene.layerItems[0]).toEqual(title)
    expect(state.document.surfaces[0]!.type === 'slide' && state.document.surfaces[0]!.scenes[0]!.layerItems[1]).toEqual(sibling)
    const effective = projectEffectiveLayers({ project: state.document, locationId, stateId: 'emphasis' })
      .unifiedRows.find(row => row.id === 'title')!.item
    if (effective.kind !== 'native' || effective.content.nativeType !== 'text') throw new Error('expected text')
    expect(effective.content.data).toMatchObject({
      text: '新头强调新尾',
      runs: [{ start: 2, end: 4, style: { bold: true, highlightColor: '#fff3a3' } }],
    })

    const reopened = openCourseProjectArchive(createCourseProjectArchive({
      project: state.document,
      assetFiles: {},
      componentFiles: {},
    }))
    expect(reopened.project).toEqual(state.document)
    expect(committed).toBeDefined()
    const undone = applyEditorTransactionStep(state, committed!, 'inverse')
    expect(undone.document).toEqual(project)
    expect(applyEditorTransactionStep(undone, committed!, 'forward').document).toEqual(state.document)
  })

  it('U01-native-roundtrip leaves the project untouched when repeated source text is ambiguous', async () => {
    const project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
    const surface = project.surfaces[0]!
    if (surface.type !== 'slide') throw new Error('expected Slide')
    const scene = surface.scenes[0]!
    const item = sceneNodeToCourseLayerItem(createTextNode({
      id: 'repeated',
      text: '甲甲',
      runs: [{ start: 0, end: 1, style: { bold: true } }],
    }), 1)
    scene.layerItems.push(item)
    const target: AuthoringToolTargetWireV1 = {
      projectId: project.id,
      documentRevision: project.revision,
      revisionPolicy: { kind: 'exact' },
      sessionGeneration: 1,
      surfaceType: 'slide',
      surfaceId: surface.id,
      locationId: project.startLocationId,
      stateId: null,
      owner: 'scene',
      ownerKey: `scene:${scene.id}`,
      itemId: 'repeated',
      authoringAddress: makeLayerItemAuthoringAddress({ projectId: project.id, owner: 'scene', surfaceId: surface.id, sceneId: scene.id, kind: 'native', layerItemId: 'repeated' }),
    }
    let commits = 0
    const receipt = await executeAuthoringTool({
      version: 1,
      requestId: crypto.randomUUID(),
      tool: nativeAuthoringTool.name,
      destination: { kind: 'update', target },
      input: { operation: 'edit-text', replacements: [{ original: '甲', replacement: '乙' }] },
    }, nativeAuthoringTool, {
      readDocument: () => project,
      validateDestination: () => null,
      commit() { commits += 1; return true },
    })
    expect(receipt).toMatchObject({ status: 'failed', diagnostics: [{ code: 'native-text-ambiguous', path: ['input', 'replacements'] }] })
    expect(commits).toBe(0)
    expect(project.surfaces[0]!.type === 'slide' && project.surfaces[0]!.scenes[0]!.layerItems[0]).toEqual(item)
  })
})
