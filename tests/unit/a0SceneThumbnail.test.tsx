// @vitest-environment jsdom
import { render, cleanup } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { CourseProjectV10 } from '../../src/shared/contracts/component-platform/project'
import { SceneThumbnail } from '../../src/renderer/ui/SceneThumbnail'

const project = vi.hoisted(() => ({
  schemaVersion: 10, id: 'thumbnail-course', revision: 0, title: '范围缩略图', assets: {},
  definitions: { decoration: { id: 'decoration', title: '本组母版装饰', role: 'content',
    implementation: { kind: 'source', language: 'javascript', source: 'export default {}' } } },
  instances: { decoration: { id: 'decoration', definitionId: 'decoration', data: {},
    frame: { width: 160, height: 40, transform: [1, 0, 0, 1, 20, 30] }, visibility: { mode: 'include', surfaceIds: ['imported'] } } },
  global: { underlay: ['decoration'], overlay: [] },
  surfaces: [{ id: 'existing', title: '原页面', kind: 'slide', designSize: { width: 1280, height: 720 }, childIds: [] },
    { id: 'imported', title: '导入页', kind: 'slide', designSize: { width: 1280, height: 720 }, childIds: [] }],
}) as CourseProjectV10)
vi.mock('../../src/renderer/store/editorStore', () => ({
  useEditorStore: (select: (state: unknown) => unknown) => select({ courseView: { project, activeDocumentId: 'document',
    surfaceId: 'existing', views: [{ documentId: 'document', model: { resources: { assets: {}, components: {} } } }] } }),
}))
afterEach(cleanup)

it('limits a shared imported decoration to its referencing page thumbnails', () => {
  const unrelated = render(<SceneThumbnail locationId="existing" />)
  expect(unrelated.container.textContent).not.toContain('本组母版装饰')
  unrelated.unmount()
  const included = render(<SceneThumbnail locationId="imported" />)
  expect(included.container.textContent).toContain('本组母版装饰')
})
