import { defaultTeacherControllerConfig } from './teacherControllerConfig'
import type { ComponentPackageData, ComponentManifest } from './componentTypes'
import { componentContentSha256 } from './componentContentIntegrity'
import { DEFAULT_TEACHER_CONTROLLER_SOURCE as source } from './defaultTeacherControllerSource'

export const DEFAULT_TEACHER_CONTROLLER_PACKAGE_ID = 'com.ittoedu.teacher-controller'

export function createDefaultTeacherControllerPackage(): ComponentPackageData {
  const manifest: ComponentManifest = {
    schemaVersion: 4, runtimeApiVersion: 4, id: DEFAULT_TEACHER_CONTROLLER_PACKAGE_ID,
    version: '1.0.0', name: '教师控制台', description: '课件编辑器内置的可编辑教师控制台源码模板', thumbnail: 'thumbnail.svg', entry: 'runtime.js', renderMode: 'dom',
    supportedScopes: ['global'], defaultSize: { width: 880, height: 64 },
    minSize: { width: 120, height: 40 }, preserveAspectRatio: false, assets: {}, defaultProps: { ...defaultTeacherControllerConfig() },
    editor: { properties: [
      { key: 'title', label: '标题', type: 'text' },
      { key: 'backgroundAssetId', label: '背景图片 / 纹理', type: 'image' },
      { key: 'style.backgroundColor', label: '背景颜色', type: 'color' },
      { key: 'style.backgroundOpacity', label: '背景不透明度', type: 'number', min: 0, max: 1, step: .1 },
      { key: 'style.textColor', label: '文字颜色', type: 'color' },
      { key: 'style.accentColor', label: '强调颜色', type: 'color' },
      { key: 'style.cornerRadius', label: '圆角', type: 'number', min: 0, max: 100 },
      { key: 'showSceneProgress', label: '显示进度', type: 'boolean' },
      { key: 'compact', label: '紧凑布局', type: 'boolean' },
      { key: 'collapsible', label: '允许收起', type: 'boolean' },
      { key: 'defaultCollapsed', label: '默认收起', type: 'boolean' },
      { key: 'includeInStaticExports', label: '包含在静态导出', type: 'boolean' },
    ] },
  }
  const encode = (value: string) => new TextEncoder().encode(value)
  const thumbnail = '<svg xmlns="http://www.w3.org/2000/svg" width="440" height="100" viewBox="0 0 440 100"><rect x="8" y="18" width="424" height="64" rx="16" fill="#252c3d"/><text x="26" y="56" fill="#f3eee0" font-family="sans-serif" font-size="18">教师控制台</text><path d="m220 42-8 8 8 8m28-16 8 8-8 8" fill="none" stroke="#f3eee0" stroke-width="2"/><text x="282" y="56" fill="#f3eee0" font-family="sans-serif" font-size="16">100%</text><circle cx="397" cy="50" r="23" fill="#4c4c49"/><text x="389" y="56" fill="#d9bf73" font-family="sans-serif" font-size="16">收</text></svg>'
  const files = { 'thumbnail.svg': encode(thumbnail), 'manifest.json': encode(JSON.stringify(manifest, null, 2)), 'runtime.js': encode(source) }
  return { manifest, runtimeSource: source, files, contentSha256: componentContentSha256(files) }
}
