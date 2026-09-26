import { describe, expect, it } from 'vitest'
import { strFromU8, unzipSync } from 'fflate'
import { buildPublishedFixture } from '../fixtures/teacherController'
import { createBlankFlowCourseProject } from '@/renderer/project/createFlowCourseProject'
import { FlowSurfaceHost } from '@/player/surfaces/flow/FlowSurfaceHost'
import { buildFlowPrintPlan, renderFlowPrintBodyHtml } from '@/renderer/export/course/flowPrintPlan'
import { buildFlowDocx } from '@/renderer/export/course/flowDocx'
import type { FlowTableBlock } from '@/shared/courseProjectTypes'

const rich = (text: string) => ({ inlines: [{ type: 'text' as const, text }] })

function fixture(headerEnabled?: boolean) {
  const project = createBlankFlowCourseProject()
  const surface = project.surfaces.find(surface => surface.type === 'flow')!
  const table: FlowTableBlock = {
    id: 'header-table', type: 'table',
    ...(headerEnabled === undefined ? {} : { headerEnabled }),
    columns: [{ id: 'a', header: rich('甲列') }, { id: 'b', header: rich('乙列') }],
    rows: [{ id: 'row-one', cells: { a: rich('甲值'), b: rich('乙值') } }],
  }
  surface.blocks.push(table)
  const payload = buildPublishedFixture({ project, assetFiles: {}, components: {} })
  const published = payload.surfaces.find(surface => surface.type === 'flow')!
  return { payload, published, surfaceId: surface.id }
}

describe('Flow table header delivery', () => {
  for (const headerEnabled of [undefined, true, false]) {
    it(`keeps first row content and semantics with headerEnabled=${String(headerEnabled)}`, async () => {
      const { payload, published, surfaceId } = fixture(headerEnabled)
      const expectedTag = headerEnabled === false ? 'td' : 'th'
      const container = document.createElement('div')
      const host = new FlowSurfaceHost(payload)
      await host.mount(container)
      const table = container.querySelector('table')!
      expect(table.querySelectorAll(`tr:first-child ${expectedTag}`)).toHaveLength(2)
      expect(table.querySelector('tr:first-child')?.textContent).toBe('甲列乙列')
      expect(table.querySelectorAll('tr')).toHaveLength(2)
      expect(table.querySelector('thead') === null).toBe(headerEnabled === false)
      await host.destroy()

      const plan = buildFlowPrintPlan(published)
      const html = new DOMParser().parseFromString(renderFlowPrintBodyHtml(plan), 'text/html')
      const printTable = html.querySelector('table')!
      expect(printTable.querySelectorAll(`tr:first-child ${expectedTag}`)).toHaveLength(2)
      expect(printTable.querySelector('tr:first-child')?.textContent).toBe('甲列乙列')
      expect(printTable.querySelectorAll('tr')).toHaveLength(2)

      const word = strFromU8(unzipSync(buildFlowDocx(payload, surfaceId).bytes)['word/document.xml']!)
      const xml = new DOMParser().parseFromString(word, 'application/xml')
      const ns = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
      const rows = [...xml.getElementsByTagNameNS(ns, 'tbl')].flatMap(tbl => [...tbl.getElementsByTagNameNS(ns, 'tr')])
      expect(rows).toHaveLength(2)
      expect(rows[0]?.textContent).toContain('甲列乙列')
      expect(rows[0]?.getElementsByTagNameNS(ns, 'tblHeader')).toHaveLength(headerEnabled === false ? 0 : 1)
      const boldValues = [...rows[0]!.getElementsByTagNameNS(ns, 'b')].map(node => node.getAttributeNS(ns, 'val'))
      expect(boldValues).toEqual(headerEnabled === false ? ['0', '0'] : [null, null])
      expect(rows[1]?.textContent).toContain('甲值乙值')
    })
  }
})
