// @vitest-environment node
import { expect, it } from 'vitest'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { prepareHtmlFramePassiveResources } from '../../src/main/workbench/htmlPreview/htmlFramePassiveResources'

it('carries nested local CSS imports and media with authored base while retaining original child source', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cw-frame-passive-'))
  try {
    await mkdir(path.join(root, 'assets'))
    await writeFile(path.join(root, 'child.css'), '@import "assets/extra.css";body{background:#fff8e8}')
    await writeFile(path.join(root, 'assets/extra.css'), 'h1{color:teal;background-image:url("../old.svg")}')
    await writeFile(path.join(root, 'old.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>')
    const html = '<link rel="stylesheet" href="../child.css"><img src="../old.svg">'
    const prepared = await prepareHtmlFramePassiveResources({ child: { html, base: 'assets/grand.html' } }, root)
    expect(prepared.child!.html).toBe(html)
    expect(prepared.child!.base).toBe('assets/grand.html')
    const resources = prepared.child!.resources!
    expect(resources['old.svg']).toMatch(/^data:image\/svg\+xml;base64,/)
    const css = Buffer.from(resources['child.css']!.split(',')[1]!, 'base64').toString()
    expect(css).toContain('color:teal')
    expect(css).toContain('data:image/svg+xml;base64,')
    expect(css).not.toContain('cw-resource:')
    await writeFile(path.join(root, 'child.css'), 'body{background:red}')
    const continued = await prepareHtmlFramePassiveResources(prepared, root)
    expect(continued.child!.resources).toEqual(resources)
  } finally { await rm(root, { recursive: true, force: true }) }
})

it('keeps remote and escaped files outside the passive local carrier', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cw-frame-passive-'))
  try {
    const html = '<link rel="stylesheet" href="https://example.test/theme.css"><img src="../secret.svg"><script src="private.js"></script>'
    const prepared = await prepareHtmlFramePassiveResources({ child: { html, base: 'child.html' } }, root)
    expect(prepared.child).toEqual({ html, base: 'child.html' })
  } finally { await rm(root, { recursive: true, force: true }) }
})
