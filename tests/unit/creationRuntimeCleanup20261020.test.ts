import { testContainerInstance } from '../helpers/glxWorkFixture'
// @vitest-environment node
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import { chromium } from '@playwright/test'
import { JSDOM } from 'jsdom'
import { expect, it } from 'vitest'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { buildPublishedCourseV3 } from '../../src/core/publish/componentPlatform/buildPublishedCourseV3'
import { compileCoursePlayback } from '../../src/core/publish/componentPlatform/compileCoursePlayback'
import { InMemoryComponentCompilation } from '../../src/core/components/compilation/InMemoryComponentCompilation'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'

async function artifact() {
  const project = createBlankCourseProjectV10('creation cleanup fault fixture')
  project.definitions.source = { id: 'source', role: 'content', implementation: { kind: 'source', language: 'javascript', source: `
    export default { mount({root,instance,scope}) {
      const marker=document.createElement('span');marker.dataset.cleanupProbe=instance.id;marker.textContent=instance.id;root.append(marker);
      scope.cleanup(()=>marker.dataset.listenerReleased='yes');
      return {update(){},async dispose(){marker.dataset.disposed='yes';if(instance.id==='first')throw new Error('author-dispose-failure')}};
    } }` } }
  for (const [index, id] of ['first', 'second'].entries()) project.instances[id] = { id, definitionId: 'source', data: {}, frame: { width: 200, height: 100, transform: [1, 0, 0, 1, index * 220, 0] } }
  testContainerInstance(project, 0).childIds = ['first', 'second']
  const bytes = new TextEncoder().encode('resource lease probe')
  project.assets.probe = { id: 'probe', path: 'assets/probe.txt', mimeType: 'text/plain', byteLength: bytes.length, filename: 'probe.txt' }
  const published = await buildPublishedCourseV3({ project, assetBytes: { probe: bytes } }, { compilation: new InMemoryComponentCompilation(createEsbuildComponentCompiler()) })
  const dom = new JSDOM('<!doctype html>')
  try {
    const artifact = await compileCoursePlayback(published.payload, { document: dom.window.document, renderBuiltin: async () => '' })
    // Fault injection stays inside a legal artifact's existing factory/asset
    // ports. The direct builtin makes both ordinary Host disposals observable.
    const { path: _path, ...asset } = project.assets.probe
    artifact.course.assets.probe = { ...asset, url: 'data:text/plain;base64,cmVzb3VyY2UgbGVhc2UgcHJvYmU=' }
    artifact.course.definitions.source.implementation = { kind: 'builtin', key: 'cleanup-probe' }
    artifact.builtinFactories['cleanup-probe'] = `function(globals){return{mount({root,instance,scope}){
      const marker=globals.document.createElement('span');marker.dataset.cleanupProbe=instance.id;root.append(marker);
      scope.cleanup(()=>marker.dataset.listenerReleased='yes');
      return{update(){},async dispose(){marker.dataset.disposed='yes';if(instance.id==='first')throw new Error('author-dispose-failure')}};
    }}}`
    return artifact
  }
  finally { dom.window.close() }
}

let playerBundle: Promise<string> | undefined
async function fixture() {
  playerBundle ??= process.env.CREATION_BOUNDARY_USE_DIST_PLAYER === '1'
    ? readFile('dist-player/compiled-player.iife.js', 'utf8').then(source => source + ';var CleanupFixture=CoursewareCompiledPlayer;')
    : build({ stdin: { contents: "export {mountCompiledCourse} from './src/player/componentPlatform/compiledPlayer'", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, format: 'iife', globalName: 'CleanupFixture', platform: 'browser', target: 'es2022' }).then(result => result.outputFiles[0]!.text)
  const browser = await chromium.launch({ headless: true }), page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  await page.setContent('<!doctype html><style>html,body,#root{margin:0;width:100%;height:100%}</style><main id="root"></main>')
  await page.addScriptTag({ content: await playerBundle })
  await page.evaluate(() => {
    const q: any = { created: [], revoked: [], reports: [], removedListeners: [], disconnected: 0 }
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL)
    URL.createObjectURL = value => { const url = create(value); q.created.push(url); return url }
    URL.revokeObjectURL = url => { q.revoked.push(url); revoke(url); if (q.rejectRevoke) throw new Error('secondary-lease-cleanup-failure') }
    const off = EventTarget.prototype.removeEventListener
    EventTarget.prototype.removeEventListener = function (type, ...rest) { if (type === 'load' || type === 'toggle') q.removedListeners.push(type); return off.call(this, type, ...rest as [any, any]) }
    const Observer = window.ResizeObserver
    window.ResizeObserver = class extends Observer { disconnect() { q.disconnected++; super.disconnect() } }
    ;(window as any).__cleanupFixture = q
  })
  return { browser, page }
}

async function record(name: string, value: unknown) {
  const directory = resolve('output/creation-boundary-implementation-20261020/E-F')
  await mkdir(directory, { recursive: true })
  await writeFile(resolve(directory, `F02-${name}-${process.env.CREATION_BOUNDARY_PHASE || 'latest'}.json`), JSON.stringify(value, null, 2))
}

it('releases the delivery asset lease and temporary content after a factory initialization throws, preserving its first error', async () => {
  const input = await artifact(), f = await fixture()
  input.builtinFactories.fault = 'function(){throw new Error("factory-initialization-failure")}'
  try {
    const actual = await f.page.evaluate(async serialized => {
      const input = JSON.parse(serialized)
      const q = (window as any).__cleanupFixture
      q.rejectRevoke = true
      try { await (window as any).CleanupFixture.mountCompiledCourse(input, document.getElementById('root')) }
      catch (error) { q.error = String(error) }
      return { error: q.error, created: q.created, revoked: q.revoked, remainingContent: document.getElementById('root')!.childElementCount }
    }, JSON.stringify(input))
    await record('factory-throw', actual)
    expect(actual.error).toContain('factory-initialization-failure')
    expect(actual.created.length).toBeGreaterThan(0)
    expect(actual.revoked).toEqual(actual.created)
    expect(actual.remainingContent).toBe(0)
  } finally { await f.browser.close() }
}, 20_000)

it('continues cleanup after authored dispose and runtime disposal rejection, without replacing the first disposal error', async () => {
  const input = await artifact(), f = await fixture()
  try {
    const actual = await f.page.evaluate(async serialized => {
      const input = JSON.parse(serialized)
      const q = (window as any).__cleanupFixture
      const player = await (window as any).CleanupFixture.mountCompiledCourse(input, document.getElementById('root'), { report: (message: string) => q.reports.push(message) })
      const markers = [...document.querySelectorAll<HTMLElement>('[data-cleanup-probe]')]
      const dispose = player.runtime.dispose.bind(player.runtime)
      player.runtime.dispose = async () => { await dispose(); throw new Error('runtime-disposal-failure') }
      q.rejectRevoke = true
      try { await player.dispose() } catch (error) { q.error = String(error) }
      return { error: q.error, created: q.created, revoked: q.revoked, reports: q.reports,
        markers: markers.map(node => ({ id: node.dataset.cleanupProbe, disposed: node.dataset.disposed, listenerReleased: node.dataset.listenerReleased })),
        removedListeners: q.removedListeners, disconnected: q.disconnected, remainingContent: document.getElementById('root')!.childElementCount }
    }, JSON.stringify(input))
    await record('dispose-reject', actual)
    expect(actual.markers).toEqual([{ id: 'first', disposed: 'yes', listenerReleased: 'yes' }, { id: 'second', disposed: 'yes', listenerReleased: 'yes' }])
    expect(actual.reports.some((message: string) => message.includes('author-dispose-failure'))).toBe(true)
    expect(actual.error).toContain('runtime-disposal-failure')
    expect(actual.revoked).toEqual(actual.created)
    expect(actual.removedListeners).toEqual(expect.arrayContaining(['load', 'toggle']))
    expect(actual.disconnected).toBeGreaterThan(0)
    expect(actual.remainingContent).toBe(0)
  } finally { await f.browser.close() }
}, 20_000)
