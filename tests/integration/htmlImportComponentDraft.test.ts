// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { HtmlImportService } from '../../src/main/workbench/htmlImport/HtmlImportService'
import type { DocumentSession } from '../../src/core/documents/DocumentSession'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }) })

it('keeps a component that fails admission as a draft with its reason and still imports the page', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-component-draft-'))
  roots.push(root)
  const sourcePath = path.join(root, 'lesson.html')
  await fs.writeFile(sourcePath, '<!doctype html><html><body><h1>四季</h1>'
    + '<iframe title="公转模拟" srcdoc="&lt;script&gt;document.body.textContent=1&lt;/script&gt;"></iframe></body></html>')
  const project = createBlankCourseProject({ includeDefaultController: false, controls: 'none' })
  const snapshot = { documentId: 'doc', epoch: 'epoch', revision: 0, model: { kind: 'course-v9' as const, project, resources: { assets: {}, components: {} } } } as unknown as DocumentSnapshot
  const writes: string[] = []
  let checks = 0
  const gateway = {
    stop: vi.fn(async () => {}),
    execute: vi.fn(async (_runId: string, _callId: string, call: { name: string; input: Record<string, unknown> }) => {
      if (call.name === 'build.create') return { kind: 'read', data: { job: 'job' } }
      if (call.name === 'build.write') { if (call.input.path === 'project.json') writes.push(String(call.input.content)); return { kind: 'read', data: {} } }
      if (call.name === 'build.check') return { kind: 'read', data: ++checks === 1 ? { status: 'failed' } : { status: 'ready', artifact: 'artifact' } }
      if (call.name === 'build.logs') return { kind: 'read', data: { entries: [{ level: 'error', message: '组件脚本运行失败' }] } }
      throw new Error(`Unexpected tool: ${call.name}`)
    }),
  }
  const service = new HtmlImportService({ session: { read: () => snapshot } as unknown as DocumentSession, gateway })
  const ticket = await service.prepare({ operationId: 'op', runId: 'run', targetHandle: 'handle', sourcePath, locationId: project.locations[0]!.id })
  await service.admit(ticket)
  expect(checks).toBe(2)
  const drafted = JSON.parse(writes.at(-1)!) as typeof project
  expect(drafted.components?.['公转模拟']).toMatchObject({ enabled: false, draft: { reason: '组件脚本运行失败' } })
  expect(JSON.stringify(drafted.surfaces)).toContain('"draft":{"reason":"组件脚本运行失败"}')
  expect(service.warnings(ticket).map(item => item.code)).toContain('component-draft')
})
