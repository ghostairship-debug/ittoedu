import { describe, expect, it } from 'vitest'
import type { TeacherControllerNode } from '../../src/shared/projectTypes'
import { createTeacherControllerNode } from '../../src/renderer/project/nativeNodeFactories'
import {
  createTeacherControllerLayout,
  formatTeacherControllerProgress,
  TEACHER_CONTROLLER_AUTHORING_ACTIONS,
  TEACHER_CONTROLLER_COLLAPSE_ACTION,
  TEACHER_CONTROLLER_RESIZE_HANDLES,
  TEACHER_CONTROLLER_SPATIAL_LAYER,
  teacherControllerButtonDisplayLabel,
  teacherControllerContentRect,
  teacherControllerHitTarget,
  teacherControllerSelectionChrome,
  type TeacherControllerRect,
} from '../../src/shared/teacherControllerLayout'
import {
  clientToWorld,
  createStageViewportTransform,
  resizeWorldFrameFromHandle,
  STAGE_RESIZE_HANDLE_DIRECTIONS,
  worldToClient,
  type StagePoint,
  type StageResizeHandleDirection,
} from '../../src/renderer/authoring/stageViewportTransform'
import {
  teacherControllerGestureFrame,
  teacherControllerOverlayGeometry,
  teacherControllerPropertiesPreview,
} from '../../src/renderer/authoring/v9TeacherControllerAuthoring'

function controller(
  patch: Partial<TeacherControllerNode> = {},
): TeacherControllerNode {
  return {
    id: 'teacher-controller',
    name: '教师控制器',
    type: 'teacher-controller',
    x: 820,
    y: 18,
    width: 440,
    height: 56,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    playbackInitialVisibility: 'inherit',
    title: '教师控制台',
    showSceneProgress: true,
    compact: false,
    collapsible: true,
    defaultCollapsed: false,
    buttons: [
      { id: 'previous', action: { type: 'scene.previous' }, label: '上一页', visible: true },
      { id: 'replay', action: { type: 'scene.replay' }, label: '重播', visible: true },
      { id: 'next', action: { type: 'scene.next' }, label: '下一页', visible: true },
      { id: 'sound', action: { type: 'audio.toggle-mute' }, label: '声音', visible: false },
    ],
    style: {
      backgroundColor: '#0b1720',
      backgroundOpacity: 0.94,
      accentColor: '#d9bf73',
      textColor: '#f3eee0',
      cornerRadius: 14,
    },
    includeInStaticExports: false,
    ...patch,
  }
}

describe('createTeacherControllerLayout', () => {
  it('includes a visible state-free scene directory in the default controller', () => {
    const node = createTeacherControllerNode()
    const pickerButtons = node.buttons.filter(
      (button) => button.action.type === 'scene.open-picker',
    )

    expect(pickerButtons).toHaveLength(1)
    expect(pickerButtons[0]).toMatchObject({
      label: '场景目录',
      visible: true,
      action: { type: 'scene.open-picker' },
    })
  })

  it('只排列可见按钮并保持在横向控制条范围内', () => {
    const layout = createTeacherControllerLayout(controller(), 440, 56)

    expect(layout.buttons.map((button) => button.action.type)).toEqual([
      'scene.previous',
      'scene.replay',
      'scene.next',
    ])
    expect(layout.progress).not.toBeNull()
    expect(layout.title.x + layout.title.width).toBeLessThan(
      layout.buttons[0]!.x,
    )
    for (const button of layout.buttons) {
      expect(button.x).toBeGreaterThanOrEqual(0)
      expect(button.y).toBeGreaterThanOrEqual(0)
      expect(button.x + button.width).toBeLessThanOrEqual(layout.width)
      expect(button.y + button.height).toBeLessThanOrEqual(layout.height)
    }
  })

  it('紧凑模式隐藏进度占位并为按钮保留更多空间', () => {
    const normal = createTeacherControllerLayout(controller(), 440, 56)
    const compact = createTeacherControllerLayout(
      controller({ compact: true }),
      440,
      56,
    )

    expect(compact.progress).toBeNull()
    expect(compact.buttons[0]!.x).toBeLessThan(normal.buttons[0]!.x)
  })

  it('钳制尺寸、圆角、透明度并为非法颜色提供稳定后备', () => {
    const source = controller({
      style: {
        backgroundColor: 'invalid',
        backgroundOpacity: 3,
        accentColor: '#BADHEX',
        textColor: '',
        cornerRadius: 999,
      },
    })
    const layout = createTeacherControllerLayout(source, 4, 8)

    expect(layout.width).toBe(16)
    expect(layout.height).toBe(16)
    expect(layout.cornerRadius).toBe(8)
    expect(layout.palette).toMatchObject({
      backgroundCss: '#0b1720',
      backgroundAlpha: 1,
      accentCss: '#d9bf73',
      textCss: '#f3eee0',
    })
  })

  it('按当前场景和状态生成播放器进度文字', () => {
    const scenes = [
      { id: 'intro', name: '导入' },
      { id: 'practice', name: '课堂练习' },
    ]

    expect(formatTeacherControllerProgress(scenes, 'practice', '答题中'))
      .toBe('2 / 2 · 课堂练习 · 答题中')
    expect(formatTeacherControllerProgress(scenes, null, null))
      .toBe('场景 — / 2 · 等待开始')
  })

  it('声音和全屏按钮根据播放器状态更新标签', () => {
    const sound = { action: { type: 'audio.toggle-mute' as const }, label: '声音' }
    const fullscreen = {
      action: { type: 'player.fullscreen.toggle' as const },
      label: '全屏',
    }

    expect(teacherControllerButtonDisplayLabel(sound, {
      muted: false,
      fullscreen: false,
    })).toBe('声音 · 开')
    expect(teacherControllerButtonDisplayLabel(sound, {
      muted: true,
      fullscreen: false,
    })).toBe('声音 · 关')
    expect(teacherControllerButtonDisplayLabel(fullscreen, {
      muted: false,
      fullscreen: true,
    })).toBe('退出全屏')
  })
})

describe('teacher controller geometry contract', () => {
  it('shares one canonical box for content, selection chrome, overlay and properties preview', () => {
    const start = { x: 190, y: 638, width: 900, height: 64 }
    expect(teacherControllerContentRect(start)).toEqual(start)
    expect(teacherControllerSelectionChrome(start)).toEqual(start)
    const transform = createStageViewportTransform({
      viewport: { x: 0, y: 0, width: 1280, height: 720 },
      zoom: 2,
      pan: { x: 0, y: 0 },
    })
    const overlay = teacherControllerOverlayGeometry(transform, start, 0)
    expect(overlay).not.toBeNull()
    expect(overlay!.objects).toHaveLength(1)
    expect(overlay!.objects[0]).toEqual(overlay!.selectionBox)
    const expectedBox = {
      x: transform.stageRect.x + start.x * transform.scale,
      y: transform.stageRect.y + start.y * transform.scale,
      width: start.width * transform.scale,
      height: start.height * transform.scale,
    }
    expect(overlay!.selectionBox).toEqual(expectedBox)
    const west = overlay!.handles.w
    expect(west).toEqual(worldToClient(transform, {
      x: start.x,
      y: start.y + start.height / 2,
    }))
    const preview = teacherControllerPropertiesPreview(controller(), start)
    const live = createTeacherControllerLayout(controller(), start.width, start.height)
    expect(preview).toEqual(live)
    expect(preview.buttons.map((button) => button.action.type)).toEqual(
      live.buttons.map((button) => button.action.type),
    )
  })

  it('resizes every handle toward the dragged edge and keeps preview identical to commit', () => {
    const start = { x: 100, y: 80, width: 200, height: 60 }
    const cases: Array<[StageResizeHandleDirection, StagePoint, TeacherControllerRect]> = [
      ['e', { x: 330, y: 110 }, { x: 100, y: 80, width: 230, height: 60 }],
      ['w', { x: 80, y: 110 }, { x: 80, y: 80, width: 220, height: 60 }],
      ['s', { x: 200, y: 160 }, { x: 100, y: 80, width: 200, height: 80 }],
      ['n', { x: 200, y: 70 }, { x: 100, y: 70, width: 200, height: 70 }],
      ['se', { x: 330, y: 160 }, { x: 100, y: 80, width: 230, height: 80 }],
      ['nw', { x: 80, y: 70 }, { x: 80, y: 70, width: 220, height: 70 }],
      ['ne', { x: 330, y: 70 }, { x: 100, y: 70, width: 230, height: 70 }],
      ['sw', { x: 80, y: 160 }, { x: 80, y: 80, width: 220, height: 80 }],
    ]
    expect(TEACHER_CONTROLLER_RESIZE_HANDLES).toEqual([...STAGE_RESIZE_HANDLE_DIRECTIONS])
    for (const [direction, currentWorld, expected] of cases) {
      const pointer = {
        kind: 'resize' as const,
        direction,
        startWorld: { x: 0, y: 0 },
        currentWorld,
      }
      const preview = teacherControllerGestureFrame(start, pointer, 'preview')
      const commit = teacherControllerGestureFrame(start, pointer, 'commit')
      expect(preview).toEqual(commit)
      expect(preview).toEqual(expected)
      expect(resizeWorldFrameFromHandle(start, direction, currentWorld)).toEqual(expected)
    }
  })

  it('maps zoomed client deltas through stageViewportTransform without a second matrix', () => {
    const transform = createStageViewportTransform({
      viewport: { x: 0, y: 0, width: 1280, height: 720 },
      zoom: 2,
      pan: { x: 0, y: 0 },
    })
    const start = { x: 100, y: 80, width: 200, height: 60 }
    const westHandle = worldToClient(transform, { x: 100, y: 110 })
    const dragged = { x: westHandle.x - 40, y: westHandle.y }
    const world = clientToWorld(transform, dragged)
    expect(world.x).toBeCloseTo(80)
    const next = teacherControllerGestureFrame(start, {
      kind: 'resize',
      direction: 'w',
      startWorld: { x: 100, y: 110 },
      currentWorld: world,
    }, 'preview')
    expect(next).toEqual({ x: 80, y: 80, width: 220, height: 60 })
    const fast = teacherControllerGestureFrame(start, {
      kind: 'move',
      startWorld: { x: 200, y: 110 },
      currentWorld: { x: 280, y: 150 },
    }, 'preview')
    const diagonal = teacherControllerGestureFrame(start, {
      kind: 'move',
      startWorld: { x: 200, y: 110 },
      currentWorld: { x: 280, y: 150 },
    }, 'commit')
    expect(fast).toEqual(diagonal)
    expect(fast).toEqual({ x: 180, y: 120, width: 200, height: 60 })
  })

  it('exposes the authoring action set with collapse as chrome, not a locate action', () => {
    expect(TEACHER_CONTROLLER_AUTHORING_ACTIONS.map((action) => action.type)).toEqual([
      'scene.previous',
      'scene.next',
      'scene.open-picker',
      'scene.replay',
      'audio.toggle-mute',
      'player.fullscreen.toggle',
    ])
    expect(TEACHER_CONTROLLER_SPATIAL_LAYER).toBe('viewport')
    expect(TEACHER_CONTROLLER_COLLAPSE_ACTION).toBe('collapse')
    const layout = createTeacherControllerLayout(controller({
      collapsible: true,
      buttons: [
        { id: 'previous', action: { type: 'scene.previous' }, label: '上一页', visible: true },
        { id: 'next', action: { type: 'scene.next' }, label: '下一页', visible: true },
        { id: 'picker', action: { type: 'scene.open-picker' }, label: '场景目录', visible: true },
        { id: 'replay', action: { type: 'scene.replay' }, label: '重播', visible: true },
        { id: 'sound', action: { type: 'audio.toggle-mute' }, label: '声音', visible: true },
        { id: 'fullscreen', action: { type: 'player.fullscreen.toggle' }, label: '全屏', visible: true },
      ],
    }), 900, 64)
    expect(layout.collapse).not.toBeNull()
    expect(layout.buttons.map((button) => button.action.type)).toEqual([
      'scene.previous',
      'scene.next',
      'scene.open-picker',
      'scene.replay',
      'audio.toggle-mute',
      'player.fullscreen.toggle',
    ])
    expect(teacherControllerHitTarget(
      { x: layout.collapse!.x + 1, y: layout.collapse!.y + 1 },
      layout,
      false,
    )).toBe('collapse')
  })
})
