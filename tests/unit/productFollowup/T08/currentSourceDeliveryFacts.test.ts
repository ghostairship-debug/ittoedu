// @vitest-environment node
import { expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../../../src/core/course/createCourseProjectV10'
import { buildPublishedCourseV3 } from '../../../../src/core/publish/componentPlatform/buildPublishedCourseV3'

const usedUrl = 'https://images.example/lesson.png'
const staleUrl = 'https://old.example/removed.png'
function author(html: string, resourceSources?: Array<{ url: string; usage: 'image' }>) {
  const project = createBlankCourseProjectV10('当前源文资源事实')
  project.definitions.web = { id: 'web', role: 'content', implementation: { kind: 'builtin', key: 'guoling.web' } }
  project.instances.web = { id: 'web', definitionId: 'web', data: { html, ...(resourceSources ? { resourceSources } : {}) } }
  project.surfaces[0].childIds = ['web']
  return project
}

it('actual image markup without optional metadata reports its network dependency in the real Published producer', async () => {
  const source = `<p>授课正文</p><img src="${usedUrl}" alt="教学图片">`
  const project = author(source)
  const published = await buildPublishedCourseV3({ project, assetBytes: {} })
  expect(published.offlineComplete).toBe(false)
  expect(published.diagnostics).toContainEqual(expect.objectContaining({ code: 'network-dependency', message: expect.stringContaining(usedUrl), path: ['instances', 'web', 'data', 'html'] }))
  expect(published.payload.instances.web.data).toMatchObject({ html: source })
  expect(project.instances.web.data).toMatchObject({ html: source })
})

it.each([
  `<p>供教师阅读的网址：${usedUrl}</p>`,
  `<p>数据示例</p><script>window.lessonData={urls:["${usedUrl}"],imageLabel:"${usedUrl}"};</script>`,
])('an ordinary URL in text or program data does not claim an actual network resource use', async source => {
  const published = await buildPublishedCourseV3({ project: author(source), assetBytes: {} })
  expect(published.offlineComplete).toBe(true)
  expect(published.diagnostics).toEqual([])
  expect(published.payload.instances.web.data).toMatchObject({ html: source })
})

it('a source edit supersedes stale resource declarations when computing actual delivery dependencies', async () => {
  const project = author(`<img src="${usedUrl}">`, [{ url: staleUrl, usage: 'image' }])
  const withImage = await buildPublishedCourseV3({ project, assetBytes: {} })
  expect(withImage.offlineComplete).toBe(false)
  expect(withImage.diagnostics).toContainEqual(expect.objectContaining({ code: 'network-dependency', message: expect.stringContaining(usedUrl) }))
  expect(withImage.diagnostics.some(value => value.message.includes(staleUrl))).toBe(false)
  project.instances.web.data = { html: `<p>现在仅解释这个地址 ${usedUrl}</p>`, resourceSources: [{ url: staleUrl, usage: 'image' }] }
  const edited = await buildPublishedCourseV3({ project, assetBytes: {} })
  expect(edited.offlineComplete).toBe(true)
  expect(edited.diagnostics).toEqual([])
  expect(edited.payload.instances.web.data).toEqual(project.instances.web.data)
  // This proves producer delivery facts, not remote availability or authored program execution.
})
