import { _electron as electron, expect, test } from '@playwright/test'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'

const root = resolve(__dirname, '../..')
test('G20 B01 real main IPC isolates two courses and untitled Markdown across renderer reload and save/reopen', async ({}, info) => {
  test.setTimeout(90_000)
  const output = join(root, 'output/g20/b01/electron')
  mkdirSync(output, { recursive: true })
  const directory = mkdtempSync(join(output, 'run-'))
  const paths = [join(directory, '课件 A.h5lesson'), join(directory, '课件 B.h5lesson')]
  paths.forEach(filename => copyFileSync(join(root, 'tests/fixtures/course-project-v9/slide-native.h5lesson'), filename))
  const app = await electron.launch({ cwd: root, args: ['.', `--user-data-dir=${join(directory, 'profile')}`], env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
  try {
    const page = await app.firstWindow()
    await page.getByRole('button', { name: '打开工作空间', exact: true }).first().waitFor()
    const result = await page.evaluate(async paths => {
      const api = window.desktopAPI!.documents!
      const [a, b, md] = await Promise.all([api.open(paths[0]!), api.open(paths[1]!), api.create({ kind: 'markdown', source: '', resources: { assets: {}, components: {} } }, '未保存.md')])
      const events: string[] = []
      const stop = api.subscribe(event => { if (event.type === 'changed') events.push(event.snapshot.documentId) })
      for (const [snapshot, label] of [[a, 'A object edited'], [b, 'B object edited']] as const) {
        if (snapshot.model.kind !== 'course-v9') throw new Error('wrong driver')
        const surface = snapshot.model.project.surfaces.find(value => value.type === 'slide')!
        if (surface.type !== 'slide') throw new Error('wrong surface')
        const item = surface.scenes[0]!.layerItems[0]!
        const receipt = await api.dispatch({ documentId: snapshot.documentId, epoch: snapshot.epoch, operationId: label, actor: 'human', baseRevision: snapshot.revision,
          mutation: { type: 'command', command: { type: 'course.object.patch', locationId: snapshot.model.project.locations[0]!.id, itemId: item.layerItemId, patch: { label } } } })
        if (receipt.status !== 'applied') throw new Error(JSON.stringify(receipt))
      }
      const mdReceipt = await api.dispatch({ documentId: md.documentId, epoch: md.epoch, operationId: 'md-input', actor: 'human', baseRevision: md.revision,
        mutation: { type: 'command', command: { type: 'markdown.replace', source: '# 无路径的当前稿\r\n' } } })
      const bNow = await api.read(b.documentId)
      await api.dispatch({ documentId: b.documentId, epoch: b.epoch, operationId: 'undo-b', actor: 'human', baseRevision: bNow.revision, mutation: { type: 'undo' } })
      stop()
      return { ids: [a.documentId, b.documentId, md.documentId], mdReceipt, events, snapshots: await api.list() }
    }, paths)
    expect(new Set(result.ids).size).toBe(3)
    expect(result.mdReceipt).toMatchObject({ status: 'applied', persistence: 'recoverable' })
    expect(new Set(result.events).size).toBe(3)
    await page.reload()
    const afterReload = await page.evaluate(async ids => Promise.all(ids.map(id => window.desktopAPI!.documents!.read(id))), result.ids)
    for (const snapshot of afterReload) expect(snapshot).toEqual(result.snapshots.find(value => value.documentId === snapshot.documentId))
    expect(afterReload[2]).toMatchObject({ dirty: true, undoDepth: 1, model: { source: '# 无路径的当前稿\r\n' } })
    const saved = join(directory, '正式另存.h5lesson')
    const reopened = await page.evaluate(async input => {
      const api = window.desktopAPI!.documents!
      const saved = await api.save(input.id, input.path)
      await api.close(input.id)
      return { saved, reopened: await api.open(input.path) }
    }, { id: result.ids[0]!, path: saved })
    expect(reopened.saved.dirty).toBe(false)
    expect(reopened.reopened.model).toEqual(reopened.saved.model)
    const archive = openCourseProjectArchive(new Uint8Array(readFileSync(saved)))
    const surface = archive.project.surfaces.find(value => value.type === 'slide')!
    if (surface.type !== 'slide') throw new Error('wrong surface')
    expect(surface.scenes[0]!.layerItems[0]!.label).toBe('A object edited')
    writeFileSync(join(directory, 'ipc-evidence.json'), JSON.stringify({ ids: result.ids, events: result.events, revisions: afterReload.map(value => value.revision), retainedHistory: afterReload.map(value => value.undoDepth), savedPath: saved }, null, 2))
    await info.attach('ipc-evidence', { path: join(directory, 'ipc-evidence.json'), contentType: 'application/json' })
  } finally {
    await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => {})
    await app.close().catch(() => {})
  }
})
