import { beforeEach, describe, expect, it } from 'vitest'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type { ComponentPackageData } from '@/shared/componentTypes'
import { componentContentSha256 } from '@/shared/componentContentIntegrity'
import { useEditorStore,
  selectActiveCourseProjectDocument,
} from '@/renderer/store/editorStore'

const PACKAGE_ID = 'com.example.catalog-card'

function catalogPackage(sha256: string): ComponentPackageData {
  const manifest: ComponentPackageData['manifest'] = {
      schemaVersion: 4,
      runtimeApiVersion: 4,
      renderMode: 'dom',
      supportedScopes: ['scene'],
      id: PACKAGE_ID,
      name: '目录卡片',
      version: '1.0.0',
      entry: 'runtime.js',
      defaultSize: { width: 320, height: 180 },
      minSize: { width: 160, height: 90 },
      preserveAspectRatio: false,
      assets: {},
      defaultProps: { content: { title: '卡片' } },
  }
  const runtimeSource = 'window.CoursewareComponent.define({ runtimeApiVersion: 4 })'
  const files = {
    'manifest.json': new TextEncoder().encode(JSON.stringify(manifest)),
    'runtime.js': new TextEncoder().encode(runtimeSource),
  }
  return {
    manifest,
    runtimeSource,
    files,
    contentSha256: componentContentSha256(files),
    provenance: {
      sha256,
      importedAt: '2026-08-10T00:00:00.000Z',
      sourceLabel: '测试目录',
    },
  }
}

describe('组件目录版本锁定', () => {
  beforeEach(() => {
    useEditorStore.getState().createNewProject()
  })

  it('拒绝同一 ID 与版本对应不同哈希的替换，且保持工程不变', () => {
    const original = catalogPackage('a'.repeat(64))
    useEditorStore.getState().importComponentPackage(original)
    const projectBefore = structuredClone(selectActiveCourseProjectDocument(useEditorStore.getState())!)
    const historyBefore = useEditorStore.getState().history.past.length

    expect(() => useEditorStore.getState().replaceComponentPackage(
      PACKAGE_ID,
      catalogPackage('b'.repeat(64)),
    )).toThrow('同版本哈希不一致')

    const state = useEditorStore.getState()
    expect(selectActiveCourseProjectDocument(state)!).toEqual(projectBefore)
    expect(state.componentPackages[PACKAGE_ID]).toBe(original)
    expect(state.history.past).toHaveLength(historyBefore)
  })

  it('将哈希、导入时间和来源作为不可拆分的 Project V8 元数据保存', () => {
    useEditorStore.getState().importComponentPackage(catalogPackage('a'.repeat(64)))
    const project = structuredClone(selectActiveCourseProjectDocument(useEditorStore.getState())!)
    expect(courseProjectDocumentSchema.safeParse(project).success).toBe(true)

    delete project.componentPackages[PACKAGE_ID]!.importedAt
    expect(courseProjectDocumentSchema.safeParse(project).success).toBe(false)
  })
})
