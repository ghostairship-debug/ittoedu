// @vitest-environment node
import { expect, it } from 'vitest'
import { build } from 'esbuild'
import { chromium } from '@playwright/test'
import { JSDOM } from 'jsdom'
import { mkdir, writeFile } from 'node:fs/promises'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { createCourseSurface } from '../../src/core/course/courseSurfaceStructure'
import { DocumentSession } from '../../src/core/documents/DocumentSession'
import { CourseV10Driver } from '../../src/core/drivers/CourseV10Driver'
import { captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { canonicalComponentFileEdits, type ComponentProjectSnapshot } from '../../src/core/projectFiles/componentPlatform/coordinator'
import { componentProjectFiles } from '../../src/core/projectFiles/componentPlatform/projection'
import { buildPublishedCourseV3 } from '../../src/core/publish/componentPlatform/buildPublishedCourseV3'
import { compileCoursePlayback } from '../../src/core/publish/componentPlatform/compileCoursePlayback'
import { InMemoryComponentCompilation } from '../../src/core/components/compilation/InMemoryComponentCompilation'
import { createEsbuildComponentCompiler } from '../../src/main/workbench/contentApply/compilation/esbuildComponentCompiler'
import type { mountCompiledCourse } from '../../src/player/componentPlatform/compiledPlayer'
import type { CompiledCoursePlayback } from '../../src/core/publish/componentPlatform/compiledContract'
import type { DocumentSnapshot } from '../../src/shared/workbench/document'

declare global {
  interface Window {
    NavigationPresentation: { mountCompiledCourse: typeof mountCompiledCourse }
    navigationPresentationArtifact?: CompiledCoursePlayback
    navigationPresentationPlayer?: Awaited<ReturnType<typeof mountCompiledCourse>>
    navigationPresentationReports?: string[]
  }
}

function courseSnapshot(snapshot: DocumentSnapshot): ComponentProjectSnapshot {
  if (snapshot.model.kind !== 'course-v10') throw new Error('Expected current V10 course snapshot')
  return { ...snapshot, model: snapshot.model }
}

it('retains authored playback settings through surface creation, project.json edits, archive reopen and Published', async () => {
  const project = createBlankCourseProjectV10('作者导航'), driver = new CourseV10Driver()
  expect(project.playback).toEqual({ controls: 'none', keyboardNavigation: true,
    presenter: { enabled: true, strategy: 'scene-navigation', additionalBindings: [] } })
  const other = createBlankCourseProjectV10()
  if (!other.playback || !project.playback) throw new Error('New courses must include authored playback settings')
  other.playback.presenter.additionalBindings.push({ id: 'test', command: 'next', key: 'n',
    altKey: false, ctrlKey: false, shiftKey: false, metaKey: false })
  expect(project.playback.presenter.additionalBindings).toEqual([])
  let saved: Uint8Array | undefined
  const session = await DocumentSession.create({ documentId: 'navigation', epoch: 'navigation',
    binding: { kind: 'file', path: 'navigation.h5lesson', version: null, bindingVersion: 0 },
    model: { kind: 'course-v10', project, resources: { assets: {}, components: {} } } }, driver,
  { async append() {}, async save(input) {
    if (input.binding.kind !== 'file') throw new Error('Expected file binding')
    saved = input.bytes; return input.binding
  } })
  const execute = async (edits: Parameters<typeof captureComponentOperation>[1]) => {
    const snapshot = courseSnapshot(session.read())
    expect((await session.execute({ documentId: snapshot.documentId, epoch: snapshot.epoch, baseRevision: snapshot.revision,
      operationId: String(snapshot.revision), actor: 'agent', mutation: { type: 'command',
        command: captureComponentOperation(snapshot.model.project, edits) } })).status).toBe('applied')
  }
  await execute([{ type: 'surface.insert', surface: createCourseSurface(project, { kind: 'slide' }), index: 1 }])
  for (const controls of ['canvas', 'none'] as const) {
    const snapshot = courseSnapshot(session.read())
    const settings = componentProjectFiles(snapshot.model.project, snapshot.model.resources).find(file => file.path === 'project.json')
    if (!settings) throw new Error('Expected project.json author settings projection')
    await execute(canonicalComponentFileEdits(snapshot, settings, JSON.stringify({ playback: { controls } })))
    await session.save()
    if (!saved) throw new Error('Session must save actual archive bytes')
    const reopened = driver.load(saved)
    if (reopened.kind !== 'course-v10') throw new Error('Expected V10')
    expect(reopened.project.surfaces).toHaveLength(2)
    expect(reopened.project.playback).toEqual({ ...project.playback, controls })
    const published = await buildPublishedCourseV3({ project: reopened.project, assetBytes: {} })
    expect(published.payload.playback).toEqual(reopened.project.playback)
  }
})

const authoredNavigation = `export function mount({root,scope,teacherController:nav}) {
  root.innerHTML='<section style="padding:24px;background:#173e4f;color:white;border-radius:20px"><output id="where"></output><div style="display:flex;gap:16px;margin-top:16px"><button id="advance">展开线索</button><button id="verify">前往验证</button><button id="return">回看观察</button></div></section>';
  const next=root.querySelector('#advance'), verify=root.querySelector('#verify'), back=root.querySelector('#return');
  const sync=()=>{const snapshot=nav.read(),p=snapshot.progress;root.querySelector('#where').textContent=p.sceneName+' / '+p.stepName;next.textContent=p.sceneIndex===0&&p.stepIndex===0?'展开线索':'继续探索';next.disabled=!nav.canExecute({type:'step.next'});back.disabled=!nav.canExecute({type:'scene.previous'});};
  next.onclick=()=>nav.execute({type:'step.next'},scope.signal);
  verify.onclick=()=>nav.execute({type:'scene.go',sceneId:'verify'},scope.signal);
  back.onclick=()=>nav.execute({type:'scene.previous'},scope.signal);
  const off=nav.subscribe(sync);sync();return{update(){sync()},dispose(){off()}};
}`

it('uses content buttons for real step/scene navigation without outer chrome, while older unset playback keeps its pointer fallback', async () => {
  const output = 'output/repair-visual-interactive-20261015/run-db19oE/navigation'
  await mkdir(output, { recursive: true })
  const project = createBlankCourseProjectV10('内容导航')
  project.surfaces = [{ id: 'observe', kind: 'slide', title: '观察', childIds: [], designSize: { width: 1280, height: 720 },
    presentation: { states: [{ id: 'clue', title: '线索', overrides: {} }] } },
  { id: 'verify', kind: 'slide', title: '验证', childIds: [], designSize: { width: 1280, height: 720 } }]
  project.definitions.navigation = { id: 'navigation', role: 'content', implementation: { kind: 'source', language: 'javascript', source: authoredNavigation } }
  project.instances.navigation = { id: 'navigation', definitionId: 'navigation', data: {}, frame: { width: 620, height: 180, transform: [1, 0, 0, 1, 300, 470] } }
  project.global.overlay.push('navigation')
  const published = await buildPublishedCourseV3({ project, assetBytes: {} }, { compilation: new InMemoryComponentCompilation(createEsbuildComponentCompiler()) })
  const dom = new JSDOM('<!doctype html>')
  const artifact = await compileCoursePlayback(published.payload, { document: dom.window.document, renderBuiltin: async () => { throw new Error('Unexpected static builtin') } })
  dom.window.close()
  expect(artifact.diagnostics).toEqual([])
  const bundle = await build({ stdin: { contents: "export {mountCompiledCourse} from './src/player/componentPlatform/compiledPlayer'", resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, write: false, format: 'iife', globalName: 'NavigationPresentation', platform: 'browser', target: 'es2022' })
  const browser = await chromium.launch({ headless: true }), errors: string[] = [], network: string[] = [], actual: Record<string, unknown> = {}
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    page.on('pageerror', error => errors.push(error.message))
    page.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()) })
    await page.setContent('<!doctype html><style>html,body{margin:0;width:100%;height:100%}#root{width:1280px;height:720px}</style><main id="root"></main>')
    await page.addScriptTag({ content: bundle.outputFiles[0].text })
    await page.addScriptTag({ content: `window.navigationPresentationArtifact = ${JSON.stringify(artifact)};` })
    type NavigationMode = 'none' | 'canvas' | 'unset'
    const mount = async (mode: NavigationMode) => page.evaluate<void, NavigationMode>(async mode => {
      const artifact = window.navigationPresentationArtifact
      if (!artifact) throw new Error('Expected actual compiled fixture in browser')
      if (window.navigationPresentationPlayer) { await window.navigationPresentationPlayer.dispose(); const root = document.createElement('main'); root.id = 'root'; document.body.append(root) }
      if (mode === 'unset') delete artifact.course.playback
      else {
        if (!artifact.course.playback) throw new Error('Expected new-course playback settings in compiled artifact')
        artifact.course.playback.controls = mode
      }
      const root = document.getElementById('root')
      if (!root) throw new Error('Missing real playback host')
      window.navigationPresentationPlayer = await window.NavigationPresentation.mountCompiledCourse(artifact, root,
        { report: (message: string) => (window.navigationPresentationReports ??= []).push(message) })
    }, mode)
    await mount('none')
    const authored = page.locator('[data-compiled-runtime-root="navigation"]'), read = () => page.evaluate(() => {
      if (!window.navigationPresentationPlayer) throw new Error('Expected mounted player')
      return window.navigationPresentationPlayer.navigation.read()
    })
    expect(await page.locator('[data-playback-chrome="navigation"]').count()).toBe(0)
    expect(await page.locator('[data-playback-navigation-content]').evaluate(node => node.getBoundingClientRect().height)).toBe(720)
    await authored.locator('#advance').click()
    await expect.poll(async () => (await read()).progress?.stepIndex).toBe(1)
    expect(await authored.locator('#where').textContent()).toBe('观察 / 线索')
    await authored.locator('#advance').click()
    await expect.poll(async () => (await read()).locationId).toBe('verify')
    expect(await authored.locator('#advance').isDisabled()).toBe(true)
    await authored.locator('#return').click()
    await expect.poll(async () => (await read()).locationId).toBe('observe')
    await authored.locator('#verify').click()
    await expect.poll(async () => (await read()).locationId).toBe('verify')
    actual.authored = { snapshot: await read(), chrome: 0, viewportHeight: 720 }
    await page.screenshot({ path: output + '/authored-navigation.png' })
    await mount('canvas')
    expect(await page.locator('[data-playback-chrome="navigation"]').count()).toBe(0)
    await authored.locator('#verify').click()
    await expect.poll(async () => (await read()).locationId).toBe('verify')
    actual.canvas = { snapshot: await read(), chrome: 0 }
    await mount('unset')
    const fallback = page.locator('[data-playback-chrome="navigation"]')
    expect(await fallback.isVisible()).toBe(true)
    await fallback.getByRole('button', { name: '下一步', exact: true }).click()
    await expect.poll(async () => (await read()).progress?.stepIndex).toBe(1)
    await fallback.getByRole('button', { name: '下一步', exact: true }).click()
    await expect.poll(async () => (await read()).locationId).toBe('verify')
    actual.legacy = { snapshot: await read(), chrome: 1 }
    expect(await fallback.getByRole('button', { name: '下一步', exact: true }).isDisabled()).toBe(true)
    actual.reports = await page.evaluate(() => window.navigationPresentationReports ?? [])
    expect(actual.reports).toEqual([])
    expect(errors).toEqual([]); expect(network).toEqual([])
    await page.evaluate(() => {
      if (!window.navigationPresentationPlayer) throw new Error('Expected mounted player for cleanup')
      return window.navigationPresentationPlayer.dispose()
    })
  } finally {
    await writeFile(output + '/actual.json', JSON.stringify({ ...actual, errors, network }, null, 2))
    await browser.close()
  }
}, 30000)
