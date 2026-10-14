// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) {
  if (!root.startsWith(os.tmpdir() + path.sep)) throw new Error('Unexpected fixture path')
  await fs.rm(root, { recursive: true, force: true })
} })
it('renames the original document and follows its binding, retaining content and dirty draft', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tab-rename-')); roots.push(root)
  const host = new DocumentHostService(path.join(root, 'profile'), {})
  let doc = await host.internalAPI.create({ kind: 'text', source: '原稿', resources: { assets: {}, components: {} } }, '原文.txt')
  doc = await host.internalAPI.save(doc.documentId, path.join(root, '原文.txt'))
  const renamed = await host.operate({ type: 'rename', documentId: doc.documentId, epoch: doc.epoch, name: '新名称.txt' })
  expect(renamed).toMatchObject({ documentId: doc.documentId, epoch: doc.epoch, model: { source: '原稿' }, binding: { kind: 'file', path: path.join(root, '新名称.txt') } })
  expect(await fs.readFile(path.join(root, '新名称.txt'), 'utf8')).toBe('原稿')
  await expect(host.operate({ type: 'rename', documentId: doc.documentId, epoch: doc.epoch, name: '漏扩展名' })).rejects.toMatchObject({ code: 'DOCUMENT_RENAME_FAILED', message: expect.stringContaining('扩展名') })
})
it('does not rename an old file if Save As rebinds the same document while resolving its source', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'tab-rename-race-')); roots.push(root)
  const host = new DocumentHostService(path.join(root, 'profile'), {})
  let doc = await host.internalAPI.create({ kind: 'text', source: '原稿', resources: { assets: {}, components: {} } }, '原文.txt')
  doc = await host.internalAPI.save(doc.documentId, path.join(root, '原文.txt'))
  let release!: () => void, entered!: () => void
  const gate = new Promise<void>(done => { release = done }), started = new Promise<void>(done => { entered = done })
  const list = host.files.listChildren.bind(host.files)
  vi.spyOn(host.files, 'listChildren').mockImplementationOnce(async input => { entered(); await gate; return list(input) })
  const rename = host.operate({ type: 'rename', documentId: doc.documentId, epoch: doc.epoch, name: '不应发生.txt' })
  const rejected = expect(rename).rejects.toMatchObject({ message: expect.stringContaining('绑定已改变') })
  await started
  await host.internalAPI.save(doc.documentId, path.join(root, '另存为.txt'))
  release(); await rejected
  expect(await fs.readFile(path.join(root, '原文.txt'), 'utf8')).toBe('原稿')
  expect(await fs.readFile(path.join(root, '另存为.txt'), 'utf8')).toBe('原稿')
  await expect(fs.stat(path.join(root, '不应发生.txt'))).rejects.toMatchObject({ code: 'ENOENT' })
})
