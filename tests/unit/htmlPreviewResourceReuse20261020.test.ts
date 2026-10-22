// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import * as extraction from '../../src/main/workbench/htmlImport/htmlResourceAnalysis'
import { createHtmlPreviewResourceCollector } from '../../src/main/workbench/htmlPreview/htmlPreviewResources'

const roots: string[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }) })

it('reuses one lease analysis but updates grants when local CSS changes, disappears or arrives', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'html-preview-collection-')); roots.push(root)
  const stylesheet = path.join(root, 'theme.css')
  await fs.writeFile(stylesheet, 'body{background:url(https://media.example/first.png)}')
  const source = '<link rel="stylesheet" href="theme.css"><link rel="stylesheet" href="later.css"><script>window.items=[1,2,3]</script>'
  const extract = vi.spyOn(extraction, 'analyzeHtmlResources')
  const collect = createHtmlPreviewResourceCollector()
  const first = await collect(source, root)
  expect(first).toContainEqual({ url: 'https://media.example/first.png', usage: 'image' })
  const count = extract.mock.calls.length
  expect(await collect(source, root)).toEqual(first)
  expect(extract).toHaveBeenCalledTimes(count)
  await fs.writeFile(stylesheet, 'body{background:url(https://media.example/changed.png)}')
  const changed = await collect(source, root)
  expect(changed).toContainEqual({ url: 'https://media.example/changed.png', usage: 'image' })
  expect(changed).not.toContainEqual({ url: 'https://media.example/first.png', usage: 'image' })
  await fs.unlink(stylesheet)
  expect(await collect(source, root)).toEqual([])
  await fs.writeFile(path.join(root, 'later.css'), 'body{background:url(https://media.example/arrived.png)}')
  expect(await collect(source, root)).toContainEqual({ url: 'https://media.example/arrived.png', usage: 'image' })
  expect(await collect('<img src="https://media.example/new-source.png">', root))
    .toContainEqual({ url: 'https://media.example/new-source.png', usage: 'image' })
})
