import { beforeEach, describe, expect, it } from 'vitest'
import type { AssetMeta, SceneNode } from '@/shared/projectTypes'
import { MAX_SCENE_NODES } from '@/shared/constants'
import {
  createImageNode,
  createProject,
  createTextNode,
} from '@/renderer/project/createProject'
import { buildAssetContentHashIndex } from '@/renderer/project/assetManager'
import {
  commitMediaBatchImport,
  planMediaBatchImport,
} from '@/renderer/project/mediaBatch'
import {
  layoutMediaBatchNodes,
  MAX_BATCH_CANVAS_ITEMS,
  selectActiveScene,
  useEditorStore,
} from '@/renderer/store/editorStore'

function image(id: string, width: number, height: number): AssetMeta {
  return {
    id,
    filename: `${id}.png`,
    mimeType: 'image/png',
    kind: 'image',
    path: `assets/${id}.png`,
    byteLength: 4,
    width,
    height,
  }
}

function rectangle(node: SceneNode): {
  left: number
  top: number
  right: number
  bottom: number
} {
  return {
    left: node.x,
    top: node.y,
    right: node.x + node.width,
    bottom: node.y + node.height,
  }
}

function overlaps(left: SceneNode, right: SceneNode): boolean {
  const a = rectangle(left)
  const b = rectangle(right)
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

beforeEach(() => {
  useEditorStore.getState().createNewProject()
  useEditorStore.getState().setActiveTab('elements')
})

describe('batch media transactions', () => {
  it('indexes identical bytes once so repeated imports can reuse an asset ID', async () => {
    const first = image('asset_hash_a', 800, 600)
    const second = image('asset_hash_b', 800, 600)
    const audio: AssetMeta = {
      id: 'asset_audio',
      filename: 'audio.mp3',
      mimeType: 'audio/mpeg',
      kind: 'audio',
      path: 'assets/asset_audio.mp3',
      byteLength: 4,
    }
    const index = await buildAssetContentHashIndex(
      'image',
      { [first.id]: first, [second.id]: second, [audio.id]: audio },
      {
        [first.id]: Uint8Array.from([1, 2, 3, 4]),
        [second.id]: Uint8Array.from([1, 2, 3, 4]),
        [audio.id]: Uint8Array.from([9, 9, 9, 9]),
      },
    )

    expect(index.size).toBe(1)
    expect([...index.values()][0]!.meta.id).toBe(first.id)
  })

  it('adds a batch in one transaction, keeps the elements tab, and restores bytes on redo', () => {
    const store = useEditorStore.getState()
    const items = [
      { meta: image('asset_a', 1600, 900), bytes: Uint8Array.from([1, 2, 3, 4]) },
      { meta: image('asset_b', 900, 1600), bytes: Uint8Array.from([5, 6, 7, 8]) },
      { meta: image('asset_c', 800, 600), bytes: Uint8Array.from([9, 10, 11, 12]) },
    ]
    const historyBefore = store.history.past.length

    const nodeIds = store.addImageNodes(items)
    let state = useEditorStore.getState()
    let nodes = selectActiveScene(state).nodes

    expect(nodeIds).toHaveLength(3)
    expect(state.history.past).toHaveLength(historyBefore + 1)
    expect(state.activeTab).toBe('elements')
    expect(state.selectedNodeIds).toEqual(nodeIds)
    expect(Object.keys(state.project.assets)).toEqual([
      'asset_a',
      'asset_b',
      'asset_c',
    ])
    for (const node of nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0)
      expect(node.y).toBeGreaterThanOrEqual(0)
      expect(node.x + node.width).toBeLessThanOrEqual(1280)
      expect(node.y + node.height).toBeLessThanOrEqual(720)
    }
    for (let left = 0; left < nodes.length; left += 1) {
      for (let right = left + 1; right < nodes.length; right += 1) {
        expect(overlaps(nodes[left]!, nodes[right]!)).toBe(false)
      }
    }

    store.undo()
    state = useEditorStore.getState()
    expect(selectActiveScene(state).nodes).toHaveLength(0)
    expect(state.project.assets).toEqual({})
    expect(state.assetFiles).toEqual({})

    store.redo()
    state = useEditorStore.getState()
    nodes = selectActiveScene(state).nodes
    expect(nodes).toHaveLength(3)
    expect([...state.assetFiles.asset_a!]).toEqual([1, 2, 3, 4])
  })

  it('imports a media-library batch without creating nodes and undoes it once', () => {
    const store = useEditorStore.getState()
    store.importAssets([
      { meta: image('asset_library_a', 800, 600), bytes: Uint8Array.from([1, 1, 1, 1]) },
      { meta: image('asset_library_b', 640, 480), bytes: Uint8Array.from([2, 2, 2, 2]) },
    ])

    expect(selectActiveScene(useEditorStore.getState()).nodes).toHaveLength(0)
    expect(Object.keys(useEditorStore.getState().project.assets)).toHaveLength(2)
    expect(useEditorStore.getState().history.past).toHaveLength(1)

    store.undo()
    expect(useEditorStore.getState().project.assets).toEqual({})
    expect(useEditorStore.getState().assetFiles).toEqual({})

    store.redo()
    expect(Object.keys(useEditorStore.getState().project.assets)).toEqual([
      'asset_library_a',
      'asset_library_b',
    ])
    expect([...useEditorStore.getState().assetFiles.asset_library_b!])
      .toEqual([2, 2, 2, 2])
    expect(selectActiveScene(useEditorStore.getState()).nodes).toHaveLength(0)
  })

  it('routes more than twelve valid placements to the library without creating nodes', () => {
    const items = Array.from({ length: MAX_BATCH_CANVAS_ITEMS + 1 }, (_, index) => ({
      meta: image(`asset_overflow_${index}`, 800, 600),
      bytes: Uint8Array.from([index, index, index, index]),
    }))
    const plan = planMediaBatchImport(
      'add',
      items.length,
      MAX_BATCH_CANVAS_ITEMS,
    )

    expect(plan).toEqual({ destination: 'library', overflowToLibrary: true })
    if (plan.destination === 'library') {
      useEditorStore.getState().importAssets(items)
    }

    const state = useEditorStore.getState()
    expect(selectActiveScene(state).nodes).toHaveLength(0)
    expect(Object.keys(state.project.assets)).toHaveLength(items.length)
    expect(state.selectedNodeIds).toEqual([])
    expect(state.history.past).toHaveLength(1)
  })

  it('falls back to the library instead of reporting false placement near the node limit', () => {
    const project = createProject()
    project.scenes[0]!.nodes = Array.from(
      { length: MAX_SCENE_NODES - 1 },
      () => createTextNode(),
    )
    const store = useEditorStore.getState()
    store.loadProject(project, null)
    store.setActiveTab('elements')
    const items = [
      { meta: image('asset_capacity_a', 800, 600), bytes: Uint8Array.from([1, 1, 1, 1]) },
      { meta: image('asset_capacity_b', 800, 600), bytes: Uint8Array.from([2, 2, 2, 2]) },
    ]
    const plan = planMediaBatchImport(
      'add',
      items.length,
      MAX_BATCH_CANVAS_ITEMS,
    )

    const result = commitMediaBatchImport({
      plan,
      placements: items,
      additions: items,
      placeOnCanvas: (placements) => store.addImageNodes(placements),
      importIntoLibrary: (additions) => store.importAssets(additions),
    })

    const state = useEditorStore.getState()
    expect(result).toMatchObject({
      destination: 'library',
      completedCount: 2,
      placedNodeIds: [],
      libraryFallback: 'scene-capacity',
    })
    expect(selectActiveScene(state).nodes).toHaveLength(MAX_SCENE_NODES - 1)
    expect(Object.keys(state.project.assets)).toEqual([
      'asset_capacity_a',
      'asset_capacity_b',
    ])
    expect(state.history.past).toHaveLength(1)
    expect(state.errorMessage).toContain(`${MAX_SCENE_NODES} 个节点上限`)
    expect(state.activeTab).toBe('elements')
  })

  it('lays mixed aspect ratios deterministically without overlap', () => {
    const nodes = [
      createImageNode({ id: 'a', assetId: 'asset_a', width: 640, height: 360 }),
      createImageNode({ id: 'b', assetId: 'asset_b', width: 360, height: 640 }),
      createImageNode({ id: 'c', assetId: 'asset_c', width: 500, height: 500 }),
      createImageNode({ id: 'd', assetId: 'asset_d', width: 1280, height: 720 }),
    ]
    const first = layoutMediaBatchNodes(nodes)
    const second = layoutMediaBatchNodes(nodes)
    expect(second).toEqual(first)
    for (let left = 0; left < first.length; left += 1) {
      for (let right = left + 1; right < first.length; right += 1) {
        expect(overlaps(first[left]!, first[right]!)).toBe(false)
      }
    }
  })
})

describe('continuous insertion context', () => {
  it('keeps the source tab, offsets defaults, and only active selection opens properties', () => {
    const store = useEditorStore.getState()
    store.addTextNode()
    store.addTextNode()
    store.addFormulaNode()
    store.addShapeNode('rounded-rectangle')

    let state = useEditorStore.getState()
    const nodes = selectActiveScene(state).nodes
    expect(state.activeTab).toBe('elements')
    expect(state.selectedNodeId).toBe(nodes.at(-1)!.id)
    expect(new Set(nodes.map((node) => `${node.x}:${node.y}`)).size).toBe(nodes.length)

    store.setActiveTab('elements')
    store.selectNode(nodes[0]!.id)
    state = useEditorStore.getState()
    expect(state.activeTab).toBe('properties')

    store.setActiveTab('elements')
    store.selectNodes([nodes[0]!.id, nodes[1]!.id])
    expect(useEditorStore.getState().activeTab).toBe('properties')
  })

  it('keeps the insertion tab when creating a missing teacher controller and opens properties when restoring it', () => {
    const project = createProject({ includeDefaultController: false, controls: 'none' })
    const store = useEditorStore.getState()
    store.loadProject(project, null)
    store.setActiveTab('elements')
    store.ensureTeacherController()

    const state = useEditorStore.getState()
    expect(state.activeTab).toBe('elements')
    expect(state.project.globalLayer).toHaveLength(1)
    expect(state.project.globalLayer[0]!.node.type).toBe('teacher-controller')
    expect(state.selectedNodeId).toBe(state.project.globalLayer[0]!.node.id)
    expect(state.editingScope).toBe('global')

    store.updatePlayback({ controls: 'none' })
    store.setActiveTab('elements')
    store.ensureTeacherController()

    const restoredState = useEditorStore.getState()
    expect(restoredState.activeTab).toBe('properties')
    expect(restoredState.selectedNodeId).toBe(restoredState.project.globalLayer[0]!.node.id)
  })
})
