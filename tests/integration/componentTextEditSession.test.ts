import { beforeEach, describe, expect, it } from 'vitest'
import {
  bootTriageCourseHost,
  formalCourse,
  settleCourse,
  undoCourse,
  type TriageCourseHost,
} from '../helpers/triage-t7-courseHost'
import {
  beginComponentTextEditSession,
  resolveComponentTextEdit,
  type ComponentTextEditContext,
} from '@/renderer/authoring/componentTextEditSession'
import {
  selectActiveScene,
  selectActiveSceneId,
  selectActivePresentationStateId,
  selectEditingNodes,
  selectEditingScope,
  useEditorStore,
  selectActiveCourseProjectDocument,
} from '@/renderer/store/editorStore'
import type {
  ComponentAuthoringTextTarget,
  ComponentPackageData,
} from '@/shared/componentTypes'
import { componentContentSha256 } from '@/shared/componentContentIntegrity'
import { getComponentPropValue, mergeComponentProps } from '@/shared/componentProps'
import { selectEffectiveSlideSceneNodes } from '../helpers/selectEffectiveSlideSceneNodes'

let host: TriageCourseHost

/**
 * `createNewProject` is the Store's fire-and-forget new-document entry point, so
 * the new DocumentSession is only authoritative once its activation lands.
 */
async function createNewProjectOnHost(): Promise<void> {
  const previous = useEditorStore.getState().courseDocument.documentId
  useEditorStore.getState().createNewProject()
  const deadline = Date.now() + 5000
  while (Date.now() < deadline) {
    const documentId = useEditorStore.getState().courseDocument.documentId
    if (documentId && documentId !== previous) {
      await settleCourse()
      return
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error('createNewProject did not reach the document session')
}

const packageId = 'com.example.canvas-copy-session'

function componentPackage(): ComponentPackageData {
  const manifest: ComponentPackageData['manifest'] = {
    schemaVersion: 4,
    runtimeApiVersion: 4,
    renderMode: 'hybrid',
    supportedScopes: ['scene'],
    id: packageId,
    name: '画布文字会话',
    version: '4.0.0',
    entry: 'runtime.js',
    defaultSize: { width: 420, height: 180 },
    minSize: { width: 120, height: 60 },
    preserveAspectRatio: false,
    assets: {},
    defaultProps: {
      content: { title: '基础标题', body: '基础正文' },
    },
    editor: {
      properties: [
        { key: 'content.title', label: '标题', type: 'text' },
        { key: 'content.body', label: '正文', type: 'textarea' },
      ],
    },
  }
  const runtimeSource = `window.CoursewareComponent.define({
      id:'${packageId}',
      runtimeApiVersion:4,
      create:function(){return{destroy:function(){}}}
    })`
  // DocumentSession saves the real archive, so the embedded package needs real bytes.
  const files = {
    'manifest.json': new TextEncoder().encode(JSON.stringify(manifest)),
    'runtime.js': new TextEncoder().encode(runtimeSource),
  }
  return {
    manifest,
    runtimeSource,
    files,
    contentSha256: componentContentSha256(files),
  }
}

function target(
  sceneId: string,
  nodeId: string,
): ComponentAuthoringTextTarget {
  return {
    kind: 'component-text',
    targetId: `component:scene:${nodeId}:registered:1`,
    scope: 'scene',
    sceneId,
    nodeId,
    componentId: packageId,
    key: 'content.title',
    label: '标题',
    multiline: false,
    source: 'registered',
    bounds: { x: 120, y: 100, width: 240, height: 44 },
    rotation: 0,
  }
}

function currentContext(
  targets: ReadonlyArray<Readonly<ComponentAuthoringTextTarget>>,
): ComponentTextEditContext {
  const store = useEditorStore.getState()
  return {
    projectId: selectActiveCourseProjectDocument(store)!.id,
    scope: selectEditingScope(store),
    sceneId: selectActiveSceneId(store),
    stateId: selectActivePresentationStateId(store),
    nodes: selectEditingNodes(store),
    componentPackages: store.componentPackages,
    targets,
  }
}

function titleAtState(stateId: string | null, nodeId: string): unknown {
  const store = useEditorStore.getState()
  const node = selectEffectiveSlideSceneNodes(stateId).find(
    (candidate) => candidate.id === nodeId,
  )
  if (!node || node.type !== 'external-component') return undefined
  const component = store.componentPackages[packageId]!
  return getComponentPropValue(
    mergeComponentProps(component.manifest, node.props ?? {}),
    'content.title',
  )
}

beforeEach(async () => {
  host = await bootTriageCourseHost()
  await createNewProjectOnHost()
})

describe('component canvas text session with editor store', () => {
  it('把命名状态中的文字写为该状态 override，且可单步撤销', async () => {
    const store = useEditorStore.getState()
    store.importComponentPackage(componentPackage())
    store.addExternalComponentNode(packageId, 100, 80)
    const sceneId = selectActiveSceneId(useEditorStore.getState())
    const nodeId = selectActiveScene(useEditorStore.getState()).nodes.find(
      (node) => node.type === 'external-component',
    )!.id
    store.addPresentationState('反馈')
    const stateId = selectActivePresentationStateId(useEditorStore.getState())!
    const liveTarget = target(sceneId, nodeId)
    const started = beginComponentTextEditSession(
      liveTarget,
      currentContext([liveTarget]),
    )
    if (!started.ok) throw new Error('会话未启动')
    await settleCourse()
    const historyBefore = formalCourse(host).undoDepth

    const resolved = resolveComponentTextEdit(
      started.session,
      '反馈状态标题',
      currentContext([liveTarget]),
    )
    if (!resolved.ok) throw new Error('会话提交未解析')
    useEditorStore.getState().updateNode(resolved.nodeId, { props: resolved.props })

    const scene = selectActiveScene(useEditorStore.getState())
    expect(titleAtState(null, nodeId)).toBe('基础标题')
    expect(titleAtState(stateId, nodeId)).toBe('反馈状态标题')
    expect(scene.presentation?.states.find((state) => state.id === stateId)
      ?.nodeOverrides[nodeId]).toMatchObject({
        props: { content: { title: '反馈状态标题' } },
      })
    await settleCourse()
    expect(formalCourse(host).undoDepth).toBe(historyBefore + 1)

    await undoCourse(host)
    expect(titleAtState(stateId, nodeId)).toBe('基础标题')
  })

  it('状态切换或目标注销后不会把草稿误写到基础态', () => {
    const store = useEditorStore.getState()
    store.importComponentPackage(componentPackage())
    store.addExternalComponentNode(packageId, 100, 80)
    const sceneId = selectActiveSceneId(useEditorStore.getState())
    const nodeId = selectActiveScene(useEditorStore.getState()).nodes.find(
      (node) => node.type === 'external-component',
    )!.id
    store.addPresentationState('反馈')
    const stateId = selectActivePresentationStateId(useEditorStore.getState())!
    const liveTarget = target(sceneId, nodeId)
    const started = beginComponentTextEditSession(
      liveTarget,
      currentContext([liveTarget]),
    )
    if (!started.ok) throw new Error('会话未启动')

    store.setActivePresentationState(null)
    expect(resolveComponentTextEdit(
      started.session,
      '不应进入基础态',
      currentContext([liveTarget]),
    )).toEqual({ ok: false, reason: 'context-changed' })
    expect(titleAtState(null, nodeId)).toBe('基础标题')
    expect(titleAtState(stateId, nodeId)).toBe('基础标题')

    store.setActivePresentationState(stateId)
    const restarted = beginComponentTextEditSession(
      liveTarget,
      currentContext([liveTarget]),
    )
    if (!restarted.ok) throw new Error('会话未重新启动')
    expect(resolveComponentTextEdit(
      restarted.session,
      '失效目标不应写入',
      currentContext([]),
    )).toEqual({ ok: false, reason: 'target-invalid' })
    expect(titleAtState(stateId, nodeId)).toBe('基础标题')
  })
})
