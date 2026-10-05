import type { ComponentDefinition, ComponentFrame } from '../../shared/contracts/component-platform'
import { defaultTeacherControllerConfig } from '../../shared/teacherControllerConfig'
import type { TeacherControllerData } from './types'

/** Pure author data shared by blank/PPT creation and the authoring UI. */
export const TEACHER_CONTROLLER_DEFINITION: ComponentDefinition = {
  id: 'guoling.navigation', version: '1.0.0', title: '教师控制台', role: 'mixed',
  implementation: { kind: 'builtin', key: 'guoling.navigation' },
  dataSchema: { type: 'object', properties: {
    title: { type: 'string', title: '标题' },
    enabled: { type: 'boolean', title: '启用控制台' },
    showSceneProgress: { type: 'boolean', title: '显示页面进度' },
    compact: { type: 'boolean', title: '紧凑布局' },
    collapsible: { type: 'boolean', title: '允许收起' },
    defaultCollapsed: { type: 'boolean', title: '默认收起' },
    backgroundAssetId: { type: 'string', title: '背景图片' },
    includeInStaticExports: { type: 'boolean', title: '包含于静态导出' },
    buttons: { type: 'array', title: '导航按钮' },
    style: { type: 'object', title: '外观', properties: {
      backgroundColor: { type: 'string', title: '背景颜色', format: 'color' },
      backgroundOpacity: { type: 'number', title: '背景不透明度', minimum: 0, maximum: 1, multipleOf: 0.01 },
      accentColor: { type: 'string', title: '强调颜色', format: 'color' },
      textColor: { type: 'string', title: '文字颜色', format: 'color' },
      cornerRadius: { type: 'number', title: '圆角' },
    } },
  } },
}
export function createTeacherControllerData(): TeacherControllerData {
  return { ...defaultTeacherControllerConfig(), enabled: true }
}
/** Original bottom-centred expanded layout: 880×64 at (200,638) on 1280×720. */
export function createTeacherControllerFrame(canvas: { width: number; height: number } = { width: 1280, height: 720 }): ComponentFrame {
  const height = 64, width = Math.min(880, Math.max(160, canvas.width - 40))
  return { width, height, transform: [1, 0, 0, 1, Math.round((canvas.width - width) / 2), canvas.height - height - 18] }
}
