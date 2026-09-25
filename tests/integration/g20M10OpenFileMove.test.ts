// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { WorkspaceFilesDesktopService } from '../../src/main/workbench/workspaceFilesDesktopService'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'
import type { WorkspaceFilesAPI } from '../../src/shared/workbench/workspaceFiles'

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) {
    if (!path.resolve(root).startsWith(path.resolve(os.tmpdir()) + path.sep)) throw new Error('Unsafe M10 fixture')
    await fs.rm(root, { recursive: true, force: true })
  }
})

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'g20-m10-binding-'))
  roots.push(root)
  const workspace = path.join(root, 'workspace'), target = path.join(workspace, 'target')
  await fs.mkdir(target, { recursive: true })
  const host = new DocumentHostService(path.join(root, 'journal'))
  const tree = new WorkspaceFilesDesktopService(host.files)
  const registered = await tree.authorizeRoot(workspace)
  return { root, workspace, target, host, tree, registered }
}

async function moveFromTree(tree: WorkspaceFilesDesktopService, registered: Awaited<ReturnType<WorkspaceFilesDesktopService['authorizeRoot']>>,
  name: string, resourcePolicy?: 'copy') {
  const page = await tree.operate({ type: 'list', workspaceId: registered.workspaceId, directoryEntryId: registered.rootEntryId })
  const source = page.entries.find(entry => entry.status === 'accessible' && entry.name === name)
  const destination = page.entries.find(entry => entry.status === 'accessible' && entry.name === 'target')
  if (!source || source.status !== 'accessible' || !destination || destination.status !== 'accessible') throw new Error('Missing tree item')
  const request = { type: 'move' as const, workspaceId: registered.workspaceId, operationId: `move-${name}`,
    sourceEntryIds: [source.entryId], targetDirectoryId: destination.entryId, ...(resourcePolicy ? { resourcePolicy } : {}) }
  return tree.operate(request satisfies Parameters<WorkspaceFilesAPI>[0])
}

async function humanMarkdown(host: DocumentHostService, current: DocumentSnapshot, source: string) {
  return host.internalAPI.dispatch({ documentId: current.documentId, epoch: current.epoch, baseRevision: current.revision,
    operationId: 'human-before-move', actor: 'human', mutation: { type: 'command', command: { type: 'markdown.replace', source } } })
}

it('M10-T02 keeps a dirty Markdown document and its frozen AI target on the new file binding', async () => {
  const { root, workspace, target, host, tree, registered } = await fixture()
  try {
    const original = path.join(workspace, 'draft.md'), moved = path.join(target, 'draft.md')
    await fs.mkdir(path.join(workspace, 'assets'))
    await fs.writeFile(path.join(workspace, 'assets', 'image.png'), new Uint8Array([1, 2, 3, 4]))
    await fs.writeFile(original, '# Start\n\nORIGINAL segment\n![image](assets/image.png)\n')
    const opened = await host.open(original)
    const human = '# Start\n\nHUMAN segment\n![image](assets/image.png)\n'
    await humanMarkdown(host, opened, human)
    const from = human.indexOf('HUMAN')
    await host.tools.beginRun({ runId: 'm10-md-ai', actor: 'agent', documents: [{ documentId: opened.documentId,
      writable: [{ kind: 'markdown-range', from, to: from + 5 }] }] })
    const handle = await host.tools.issueTarget('m10-md-ai', opened.documentId, { kind: 'markdown-range', from, to: from + 5 })

    expect(await moveFromTree(tree, registered, 'draft.md', 'copy')).toMatchObject({ status: 'success' })
    const rebound = await host.internalAPI.read(opened.documentId)
    expect(rebound).toMatchObject({ documentId: opened.documentId, dirty: true, undoDepth: 1,
      binding: { kind: 'file', path: moved, bindingVersion: 2 } })
    expect((await host.open(moved)).documentId).toBe(opened.documentId)
    const afterMove = await host.internalAPI.read(opened.documentId)
    if (afterMove.model.kind !== 'markdown') throw new Error('Moved Markdown changed kind')
    const manualAfterMove = `${human}After move manual\n`
    await host.internalAPI.dispatch({ documentId: opened.documentId, epoch: afterMove.epoch, baseRevision: afterMove.revision,
      operationId: 'manual-after-move', actor: 'human', mutation: { type: 'command', command: { type: 'markdown.splice',
        from: afterMove.model.source.length, to: afterMove.model.source.length, text: 'After move manual\n' } } })
    const ai = await host.tools.execute('m10-md-ai', 'replace-after-move', { name: 'text.replace', input: { target: handle, content: 'AI' } })
    expect(ai, JSON.stringify(ai)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    expect(await host.internalAPI.read(opened.documentId)).toMatchObject({ undoDepth: 3,
      model: { source: '# Start\n\nAI segment\n![image](assets/image.png)\nAfter move manual\n' }, binding: { path: moved } })

    await host.saveToPath(opened.documentId)
    expect(await fs.readFile(moved, 'utf8')).toContain('AI segment')
    await expect(fs.access(original)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await fs.readFile(path.join(target, 'assets', 'image.png'))).toEqual(Buffer.from([1, 2, 3, 4]))
    expect(await fs.readFile(path.join(workspace, 'assets', 'image.png'))).toEqual(Buffer.from([1, 2, 3, 4]))
    const reopened = await new DocumentHostService(path.join(root, 'reopen')).open(moved)
    expect(reopened.model).toMatchObject({ kind: 'markdown', source: '# Start\n\nAI segment\n![image](assets/image.png)\nAfter move manual\n' })
    expect(reopened.model.resources.assets['assets/image.png']).toEqual(new Uint8Array([1, 2, 3, 4]))
    const saved = await host.internalAPI.read(opened.documentId)
    await host.internalAPI.dispatch({ documentId: saved.documentId, epoch: saved.epoch, baseRevision: saved.revision,
      operationId: 'undo-after-move', actor: 'human', mutation: { type: 'undo' } })
    expect(await host.internalAPI.read(opened.documentId)).toMatchObject({ model: { source: manualAfterMove }, binding: { path: moved } })
    await expect(fs.access(original)).rejects.toMatchObject({ code: 'ENOENT' })
  } finally { tree.dispose() }
})

it('M10-T02 keeps a dirty V9 course, embedded resources and History through tree move and later AI edit', async () => {
  const { root, workspace, target, host, tree, registered } = await fixture()
  try {
    const original = path.join(workspace, 'course.h5lesson'), moved = path.join(target, 'course.h5lesson')
    await fs.copyFile(path.resolve('tests/fixtures/course-project-v9/multi-asset.h5lesson'), original)
    const opened = await host.open(original)
    if (opened.model.kind !== 'course-v9') throw new Error('Expected V9 fixture')
    const originals = structuredClone(opened.model.resources)
    const project = structuredClone(opened.model.project)
    project.title = '人工修改的课件名'
    await host.internalAPI.dispatch({ documentId: opened.documentId, epoch: opened.epoch, baseRevision: opened.revision,
      operationId: 'human-course-before-move', actor: 'human', mutation: { type: 'command', command: { type: 'course.replace', project } } })
    await host.tools.beginRun({ runId: 'm10-course-ai', actor: 'agent', documents: [{ documentId: opened.documentId,
      writable: [{ kind: 'course-object', locationId: 'location-scene-1', itemId: 'slide-title' }] }] })
    const handle = await host.tools.issueTarget('m10-course-ai', opened.documentId,
      { kind: 'course-object', locationId: 'location-scene-1', itemId: 'slide-title' })

    expect(await moveFromTree(tree, registered, 'course.h5lesson')).toMatchObject({ status: 'success' })
    expect(await host.internalAPI.read(opened.documentId)).toMatchObject({ documentId: opened.documentId, dirty: true,
      undoDepth: 1, binding: { kind: 'file', path: moved, bindingVersion: 2 } })
    const ai = await host.tools.execute('m10-course-ai', 'course-after-move',
      { name: 'text.replace', input: { target: handle, content: 'AI 更新的页面标题' } })
    expect(ai).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
    const changed = await host.internalAPI.read(opened.documentId)
    if (changed.model.kind !== 'course-v9') throw new Error('Course model changed kind')
    expect(changed.undoDepth).toBe(2)
    expect(changed.model.project.title).toBe('人工修改的课件名')
    expect(changed.model.resources).toEqual(originals)
    const slide = changed.model.project.surfaces.find(surface => surface.type === 'slide')
    const title = slide?.scenes[0]?.layerItems.find(item => item.layerItemId === 'slide-title')
    expect(title?.kind === 'native' && title.content.nativeType === 'text' && title.content.data.text).toBe('AI 更新的页面标题')

    await host.saveToPath(opened.documentId)
    await expect(fs.access(original)).rejects.toMatchObject({ code: 'ENOENT' })
    const reopened = await new DocumentHostService(path.join(root, 'reopen')).open(moved)
    if (reopened.model.kind !== 'course-v9') throw new Error('Reopened course changed kind')
    expect(reopened.model.project.title).toBe('人工修改的课件名')
    expect(reopened.model.resources).toEqual(originals)
    const saved = await host.internalAPI.read(opened.documentId)
    await host.internalAPI.dispatch({ documentId: saved.documentId, epoch: saved.epoch, baseRevision: saved.revision,
      operationId: 'undo-course-after-move', actor: 'human', mutation: { type: 'undo' } })
    expect(await host.internalAPI.read(opened.documentId)).toMatchObject({ undoDepth: 1, binding: { path: moved } })
    await expect(fs.access(original)).rejects.toMatchObject({ code: 'ENOENT' })
  } finally { tree.dispose() }
})
