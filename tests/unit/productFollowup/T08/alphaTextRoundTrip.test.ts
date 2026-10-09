import { afterEach, expect, it } from 'vitest'
import { readHtmlDocumentText } from '../../../../src/shared/document/htmlText'
import { createBlankCourseProjectV10 } from '../../../../src/core/course/createCourseProjectV10'
import { CourseV10Driver } from '../../../../src/core/drivers/CourseV10Driver'
import { TEXT_DEFINITION , textDataEdit } from '../../../../src/components/text/adapters'
import { createTextComponentData, textComponentDataSchema } from '../../../../src/components/text/data'
import { mountPublishedCourseV3 } from '../../../../src/player/componentPlatform/publishedPlayer'
import { buildPublishedCourseV3 } from '../../../../src/core/publish/componentPlatform/buildPublishedCourseV3'

afterEach(() => { document.body.replaceChildren() })
it('half-transparent authored HTML text keeps alpha through V10 archive and the actual professional Player renderer', async () => {
  const parsed = readHtmlDocumentText([{ kind: 'element', tagName: 'span', attributes: { style: 'color:rgba(18,52,86,0.5)' }, children: [{ kind: 'text', text: '半透明正文' }] }],
    { createFormulaId: () => 'formula' })
  const css = document.createElement('span')
  css.style.color = parsed.inlines[0].style?.color ?? ''
  expect(css.style.color).toBe('rgba(18, 52, 86, 0.5)')
  const project = createBlankCourseProjectV10('透明色保真')
  project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  project.instances.text = { id: 'text', definitionId: TEXT_DEFINITION.id, data: textDataEdit('fixture', createTextComponentData(parsed)).value, frame: { width: 320, height: 90, transform: [1, 0, 0, 1, 0, 0] } }
  project.surfaces[0].childIds = ['text']
  const driver = new CourseV10Driver(), reopened = driver.load(driver.serialize({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }))
  if (reopened.kind !== 'course-v10') throw new Error('V10 required')
  css.style.color = textComponentDataSchema.parse(reopened.project.instances.text.data).content.inlines[0].style?.color ?? ''
  expect(css.style.color).toBe('rgba(18, 52, 86, 0.5)')
  const root = document.createElement('section'); document.body.append(root)
  const publication = await buildPublishedCourseV3({ project: reopened.project, assetBytes: reopened.resources.assets, componentFiles: reopened.resources.components })
  const player = await mountPublishedCourseV3(publication.payload, root)
  try {
    const content = root.querySelector<HTMLElement>('[data-text-component-content]')
    expect(content, root.innerHTML).toBeTruthy()
    expect(content!.textContent).toBe('半透明正文')
    const runs = [...content!.querySelectorAll('span')]
    expect(runs.length).toBeGreaterThan(0)
    for (const run of runs) expect(getComputedStyle(run).color).toBe('rgba(18, 52, 86, 0.5)')
  } finally { await player.dispose() }
  // Native runtime CSS semantics are proven; actual browser pixels belong to the shared paint specimen.
})
