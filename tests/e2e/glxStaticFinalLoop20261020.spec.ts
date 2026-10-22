import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test'
import { copyFile, mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(__dirname, '../..')
const base = path.join(root, 'output/glx-work-containers-20261020/final-static')
const source = path.join(root, 'output/glx-work-containers-20261020/final-ui/v1-PSIZQD/workspace/v1-saved.glx')
const env = () => Object.fromEntries(Object.entries({ ...process.env, VITE_DEV_SERVER_URL: '', COURSEWARE_E2E_BACKGROUND: '1' })
  .filter(([key, value]) => typeof value === 'string' && key !== 'ELECTRON_RUN_AS_NODE' && !/(?:API_KEY|TOKEN|SECRET|CREDENTIAL)/i.test(key))) as Record<string, string>

async function close(app: ElectronApplication) {
  await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => undefined)
  await app.close().catch(() => undefined)
}

test('saved native slides and Flow handout export actual static files through the built Main public tool', async ({}, info) => {
  test.setTimeout(150_000)
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(path.join(base, 'run-')), workspace = path.join(directory, 'workspace')
  await mkdir(workspace)
  const savedCopy = path.join(workspace, 'preserved-slides.glx')
  await copyFile(source, savedCopy)
  const facts: Record<string, unknown> = { directory, source, savedCopy, scope: 'built Main document.export; static slide PDF/PPTX and Flow DOCX only; no model/provider requests' }
  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${path.join(directory, 'profile')}`], env: env() })
  try {
    const page = await app.firstWindow()
    await expect(page.getByLabel('切换工作空间', { exact: true })).toBeVisible()
    facts.mainPid = await app.evaluate(() => process.pid)
    facts.exports = await app.evaluate(async ({ app }, input) => {
      const { createRequire } = process.getBuiltinModule('node:module'), requireProduct = createRequire(`${app.getAppPath()}/package.json`)
      const host = requireProduct('./dist-electron/main/workbench/documentHost.js').documentHost()
      const opened = await host.internalAPI.open(input.filename), snapshot = await host.internalAPI.read(opened.documentId)
      if (snapshot.model.kind !== 'course-v10') throw new Error('The saved V1 copy is not a canonical work')
      const project = snapshot.model.project, before = JSON.stringify(snapshot.model), roots = project.rootIds.map((id: string) => ({ id, name: project.instances[id]?.name, kind: project.instances[id]?.container?.kind }))
      const runId = 'final-static-v1'
      await host.tools.beginRun({ runId, actor: 'human', documents: [{ documentId: snapshot.documentId, writable: [{ kind: 'document' }] }], fileAccess: { permission: 'workspace', workspaceRoot: input.workspace } })
      await host.tools.loadToolFamilies(runId, ['build'])
      const replies = []
      try {
        const target = await host.tools.completeOpenedDocument(runId, { documentId: snapshot.documentId, writable: true }, { selection: 'preserve' })
        for (const format of ['pdf', 'pptx']) {
          const result = await host.tools.execute(runId, `v1-${format}`, { name: 'document.export', input: { target: target.target, format, destination: `preserved-slides.${format}` } })
          replies.push({ format, result })
          if (result.kind !== 'read' || result.data?.status !== 'written') throw new Error(JSON.stringify({ format, result }))
        }
      } finally { await host.tools.stop(runId) }
      const after = await host.internalAPI.read(snapshot.documentId)
      if (JSON.stringify(after.model) !== before || after.dirty !== snapshot.dirty) throw new Error('Static output mutated the saved author work')
      return { roots, sourceRevision: snapshot.revision, dirty: snapshot.dirty, unchangedAuthorModel: true, replies }
    }, { filename: savedCopy, workspace })
    facts.flow = await app.evaluate(async ({ app }, input) => {
      const { createRequire } = process.getBuiltinModule('node:module'), requireProduct = createRequire(`${app.getAppPath()}/package.json`)
      const host = requireProduct('./dist-electron/main/workbench/documentHost.js').documentHost()
      const { createTextComponentData, createFormulaComponentData } = requireProduct('./dist-electron/components/text/data.js')
      const { createTableData } = requireProduct('./dist-electron/components/table/data.js')
      const json = (value: unknown) => JSON.parse(JSON.stringify(value))
      let cell = 0
      const table = createTableData({ rows: 1, columns: 1, idFactory: () => `cell-${++cell}` })
      table.rows[0].cells[0].text = '仍可编辑的表格'
      const project = { schemaVersion: 11, id: 'final-static-flow', revision: 0, title: 'Flow 讲义保全', rootIds: ['flow'], entry: { rootInstanceId: 'flow' }, assets: {}, global: { underlay: [], overlay: [] },
        definitions: Object.fromEntries(['container.flow', 'document-block', 'text', 'table', 'formula'].map(key => [key, { id: key, role: 'content', implementation: { kind: 'builtin', key: `guoling.${key}` } }])),
        instances: {
          flow: { id: 'flow', definitionId: 'container.flow', name: 'Flow 讲义', data: {}, childIds: ['heading', 'paragraph', 'table', 'formula'], container: { kind: 'flow', flow: { layout: { readingWidth: 860, wideContentWidth: 1100, toc: 'hidden' } } } },
          heading: { id: 'heading', definitionId: 'document-block', data: { type: 'heading', level: 1, content: { inlines: [{ type: 'text', text: 'Flow 讲义标题' }] } } },
          paragraph: { id: 'paragraph', definitionId: 'text', data: json(createTextComponentData('共同正文')) },
          table: { id: 'table', definitionId: 'table', data: json(table) },
          formula: { id: 'formula', definitionId: 'formula', data: json(createFormulaComponentData('formula-identity', '\\frac{x}{2}')) },
        } }
      const created = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'flow-handout.glx')
      const saved = await host.internalAPI.save(created.documentId, input.filename)
      const before = await host.internalAPI.read(created.documentId), runId = 'final-static-flow'
      await host.tools.beginRun({ runId, actor: 'human', documents: [{ documentId: created.documentId, writable: [{ kind: 'document' }] }], fileAccess: { permission: 'workspace', workspaceRoot: input.workspace } })
      await host.tools.loadToolFamilies(runId, ['build'])
      let result
      try {
        const target = await host.tools.completeOpenedDocument(runId, { documentId: created.documentId, writable: true }, { selection: 'preserve' })
        result = await host.tools.execute(runId, 'flow-docx', { name: 'document.export', input: { target: target.target, format: 'docx', destination: 'flow-handout.docx' } })
        if (result.kind !== 'read' || result.data?.status !== 'written') throw new Error(JSON.stringify(result))
      } finally { await host.tools.stop(runId) }
      const after = await host.internalAPI.read(created.documentId)
      if (JSON.stringify(after.model) !== JSON.stringify(before.model) || after.dirty) throw new Error('Flow output mutated the saved author work')
      return { saved: { documentId: saved.documentId, revision: saved.revision, dirty: saved.dirty, path: saved.binding.path }, unchangedAuthorModel: true, result }
    }, { filename: path.join(workspace, 'flow-handout.glx'), workspace })
    facts.files = await Promise.all(['preserved-slides.pdf', 'preserved-slides.pptx', 'flow-handout.docx', 'flow-handout.glx'].map(async filename => {
      const absolute = path.join(workspace, filename), value = await stat(absolute)
      expect(value.size).toBeGreaterThan(0)
      return { filename, path: absolute, bytes: value.size }
    }))
  } catch (error) {
    facts.failure = String(error)
    throw error
  } finally {
    await close(app)
    await writeFile(path.join(directory, 'facts.json'), JSON.stringify(facts, null, 2))
    await info.attach('actual static export facts', { path: path.join(directory, 'facts.json'), contentType: 'application/json' })
  }
})
