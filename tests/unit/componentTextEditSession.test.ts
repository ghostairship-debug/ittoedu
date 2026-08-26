import { describe, expect, it } from 'vitest'
import {
  beginComponentTextEditSession,
  componentTextEditSessionMatchesContext,
  resolveComponentTextEdit,
  type ComponentTextEditContext,
} from '@/renderer/authoring/componentTextEditSession'
import type {
  ComponentAuthoringTextTarget,
  ComponentPackageData,
} from '@/shared/componentTypes'
import type { ExternalComponentNode } from '@/shared/projectTypes'

const packageId = 'com.example.session-copy'

function componentPackage(version = '4.0.0'): ComponentPackageData {
  return {
    manifest: {
      schemaVersion: 4,
      runtimeApiVersion: 4,
      renderMode: 'hybrid',
      supportedScopes: ['scene', 'global'],
      id: packageId,
      name: '会话文字组件',
      version,
      entry: 'runtime.js',
      defaultSize: { width: 400, height: 180 },
      minSize: { width: 100, height: 60 },
      preserveAspectRatio: false,
      assets: {},
      defaultProps: {
        content: { title: '默认标题', body: '默认正文' },
      },
      editor: {
        properties: [
          { key: 'content.title', label: '标题', type: 'text' },
          { key: 'content.body', label: '正文', type: 'textarea' },
        ],
      },
    },
    runtimeSource: '',
    files: {},
  }
}

function componentNode(
  overrides: Partial<ExternalComponentNode> = {},
): ExternalComponentNode {
  return {
    id: 'component-one',
    name: '文字组件',
    type: 'external-component',
    x: 100,
    y: 80,
    width: 400,
    height: 180,
    rotation: 0,
    opacity: 1,
    visible: true,
    playbackInitialVisibility: 'inherit',
    locked: false,
    component: { packageId, version: '4.0.0' },
    props: { content: { title: '实例标题' } },
    ...overrides,
  }
}

function textTarget(
  overrides: Partial<ComponentAuthoringTextTarget> = {},
): ComponentAuthoringTextTarget {
  return {
    kind: 'component-text',
    targetId: 'component:scene-host:registered:1',
    scope: 'scene',
    sceneId: 'scene-one',
    nodeId: 'component-one',
    componentId: packageId,
    key: 'content.title',
    label: '标题',
    multiline: false,
    source: 'registered',
    bounds: { x: 120, y: 100, width: 220, height: 40 },
    rotation: 0,
    ...overrides,
  }
}

function context(
  overrides: Partial<ComponentTextEditContext> = {},
): ComponentTextEditContext {
  const node = componentNode()
  const target = textTarget()
  return {
    projectId: 'project-one',
    scope: 'scene',
    sceneId: 'scene-one',
    stateId: 'state-feedback',
    nodes: [node],
    componentPackages: { [packageId]: componentPackage() },
    targets: [target],
    ...overrides,
  }
}

describe('component canvas text edit session', () => {
  it('启动时冻结项目、作用域、场景、状态、实例、组件版本与字段', () => {
    const result = beginComponentTextEditSession(textTarget(), context())

    expect(result).toMatchObject({
      ok: true,
      value: '实例标题',
      session: {
        projectId: 'project-one',
        scope: 'scene',
        sceneId: 'scene-one',
        stateId: 'state-feedback',
        nodeId: 'component-one',
        componentId: packageId,
        componentVersion: '4.0.0',
        key: 'content.title',
      },
    })
    if (!result.ok) throw new Error('会话未启动')
    expect(Object.isFrozen(result.session)).toBe(true)
    expect(Object.isFrozen(result.session.bounds)).toBe(true)
  })

  it.each([
    ['projectId', { projectId: 'project-two' }],
    ['scope', { scope: 'global' as const }],
    ['sceneId', { sceneId: 'scene-two' }],
    ['stateId', { stateId: 'state-answer' }],
  ])('上下文 %s 切换后拒绝提交', (_label, changed) => {
    const started = beginComponentTextEditSession(textTarget(), context())
    if (!started.ok) throw new Error('会话未启动')

    expect(componentTextEditSessionMatchesContext(started.session, {
      projectId: context().projectId,
      scope: context().scope,
      sceneId: context().sceneId,
      stateId: context().stateId,
      ...changed,
    })).toBe(false)
    expect(resolveComponentTextEdit(
      started.session,
      '不应写入',
      context(changed),
    )).toEqual({ ok: false, reason: 'context-changed' })
  })

  it('目标消失、字段改变或实例版本替换后拒绝提交', () => {
    const started = beginComponentTextEditSession(textTarget(), context())
    if (!started.ok) throw new Error('会话未启动')

    expect(resolveComponentTextEdit(
      started.session,
      '不应写入',
      context({ targets: [] }),
    )).toEqual({ ok: false, reason: 'target-invalid' })
    expect(resolveComponentTextEdit(
      started.session,
      '不应写入',
      context({ targets: [textTarget({ key: 'content.body' })] }),
    )).toEqual({ ok: false, reason: 'target-invalid' })
    expect(resolveComponentTextEdit(
      started.session,
      '不应写入',
      context({
        nodes: [componentNode({
          component: { packageId, version: '4.1.0' },
        })],
        componentPackages: { [packageId]: componentPackage('4.1.0') },
      }),
    )).toEqual({ ok: false, reason: 'target-invalid' })
  })

  it('锁定组件不启动文字会话，编辑中锁定也拒绝提交', () => {
    expect(beginComponentTextEditSession(
      textTarget(),
      context({ nodes: [componentNode({ locked: true })] }),
    )).toEqual({ ok: false, reason: 'target-invalid' })

    const started = beginComponentTextEditSession(textTarget(), context())
    if (!started.ok) throw new Error('会话未启动')
    expect(resolveComponentTextEdit(
      started.session,
      '不应写入锁定组件',
      context({ nodes: [componentNode({ locked: true })] }),
    )).toEqual({ ok: false, reason: 'target-invalid' })
  })

  it('只为当前有效的公开文字字段生成 props 补丁', () => {
    const started = beginComponentTextEditSession(textTarget(), context())
    if (!started.ok) throw new Error('会话未启动')

    const resolved = resolveComponentTextEdit(
      started.session,
      '新标题',
      context(),
    )
    expect(resolved).toEqual({
      ok: true,
      nodeId: 'component-one',
      props: { content: { title: '新标题' } },
    })
  })

  it('全局组件也绑定启动时的活动场景和状态', () => {
    const globalTarget = textTarget({
      targetId: 'component:global-host:registered:1',
      scope: 'global',
      sceneId: undefined,
    })
    const globalContext = context({
      scope: 'global',
      targets: [globalTarget],
    })
    const started = beginComponentTextEditSession(globalTarget, globalContext)
    if (!started.ok) throw new Error('全局会话未启动')

    expect(started.session).toMatchObject({
      scope: 'global',
      sceneId: 'scene-one',
      stateId: 'state-feedback',
    })
    expect(resolveComponentTextEdit(
      started.session,
      '不应跨场景写入',
      { ...globalContext, sceneId: 'scene-two' },
    )).toEqual({ ok: false, reason: 'context-changed' })
  })
})
