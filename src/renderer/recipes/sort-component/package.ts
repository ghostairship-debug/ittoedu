import { parseComponentPackageFiles } from '../../../core/drivers/codecs/importComponentPackage'
import runtimeSource from './runtimeSource'

export const SORT_COMPONENT_ID = 'com.ittoedu.teaching.sort-order'
export function createSortComponentPackage() {
  const manifest = {
    schemaVersion: 4, runtimeApiVersion: 4, renderMode: 'dom', supportedScopes: ['scene'],
    id: SORT_COMPONENT_ID, version: '1.0.0', name: '教学排序', entry: 'runtime.js',
    description: '使用上移、下移按钮调整真实顺序，检查答案并重置。',
    defaultSize: { width: 1100, height: 480 }, minSize: { width: 480, height: 300 },
    preserveAspectRatio: false, assets: {},
    defaultProps: { items: 'a | 第一步\nb | 第二步\nc | 第三步', correctOrder: 'a,b,c', content: { success: '全部正确！', failure: '还需要调整，再试一次。' } },
    editor: { properties: [
      { key: 'items', label: '项目（每行：稳定 ID | 文字）', type: 'textarea', required: true },
      { key: 'correctOrder', label: '正确顺序（稳定 ID，以逗号分隔）', type: 'text', required: true },
      { key: 'content.success', label: '正确反馈', type: 'text' },
      { key: 'content.failure', label: '错误反馈', type: 'text' },
    ] },
  }
  const encode = (value: string) => new TextEncoder().encode(value)
  return parseComponentPackageFiles({ 'manifest.json': encode(JSON.stringify(manifest)), 'runtime.js': encode(runtimeSource) })
}
