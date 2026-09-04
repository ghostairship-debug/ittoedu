import { strFromU8, unzipSync, zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { courseProjectDocumentSchema } from '@/shared/courseProjectSchema'
import type { CourseProjectDocument, RuntimeLayerItem } from '@/shared/courseProjectTypes'
import { publishedCourseV2Schema } from '@/shared/publishedCourseSchema'
import {
  addCourseFlowPage,
  addCourseSpatialPage,
} from '@/renderer/course/courseLocationCommands'
import { createBlankCourseProject } from '@/renderer/project/createCourseProject'
import { parseComponentPackageFiles } from '@/renderer/components/importComponentPackage'
import type { CoursePublishSources } from '@/renderer/export/course/buildPublishedCourse'
import { buildPublishedCourseV2Payload } from '@/renderer/export/course/buildPublishedCourse'
import { decodePublishedCode } from '@/player/decodePublishedExecutableCode'
import {
  buildCoursePackages,
  buildPublishedCourseStandaloneHtml,
  buildPublishedCourseWebPackage,
  buildPublishedCourseWebPackageAsync,
  buildPublishedCourseWebPackageFiles,
} from '@/renderer/export/course/buildCoursePackages'
import {
  collectCoursePackageExportPreflight,
  CoursePackagePreflightError,
  OnlineSingleHtmlDeliveryError,
} from '@/renderer/export/course/coursePackagePreflight'
import { listCourseProjectV9Fixtures } from '../fixtures/course-project-v9/sources'

const NOW = '2026-08-17T12:00:00.000Z'
const PLAYER_BUNDLE = 'window.__COURSE_PLAYER_PLACEHOLDER__=true;'

function mixedSources(): CoursePublishSources {
  let project = createBlankCourseProject({ now: NOW, includeDefaultController: false, controls: 'none' })
  const originalLocationIds = project.locations.map((location) => location.id)

  const flowAdded = addCourseFlowPage(project, { now: NOW, expectedRevision: project.revision })
  expect(flowAdded.ok).toBe(true)
  if (!flowAdded.ok) throw new Error(flowAdded.reason)
  project = flowAdded.project

  const spatialAdded = addCourseSpatialPage(project, {
    now: NOW,
    expectedRevision: project.revision,
  })
  expect(spatialAdded.ok).toBe(true)
  if (!spatialAdded.ok) throw new Error(spatialAdded.reason)
  project = spatialAdded.project

  expect(project.locations.map((location) => location.id)).toEqual([
    ...originalLocationIds,
    flowAdded.activatedLocationId,
    spatialAdded.activatedLocationId,
  ])
  expect(project.surfaces.map((surface) => surface.type)).toEqual(['slide', 'flow', 'spatial-2d'])
  courseProjectDocumentSchema.parse(project)

  return {
    project,
    assetFiles: {},
    components: {},
  }
}

function onlineSources(): CoursePublishSources {
  const project = createBlankCourseProject({
    now: NOW,
    includeDefaultController: false,
    controls: 'none',
  })
  const hero = new Uint8Array([1, 2, 3, 4])
  const narration = new Uint8Array([5, 6, 7])
  const unused = new Uint8Array([8, 9])
  project.assets = {
    hero: {
      id: 'hero',
      filename: 'hero.png',
      mimeType: 'image/png',
      kind: 'image',
      path: 'assets/hero.png',
      byteLength: hero.byteLength,
      remote: { url: 'https://z-assets.example.com/course/hero.png?version=2' },
    },
    narration: {
      id: 'narration',
      filename: 'narration.mp3',
      mimeType: 'audio/mpeg',
      kind: 'audio',
      path: 'assets/narration.mp3',
      byteLength: narration.byteLength,
      remote: { url: 'https://a-media.example.com/audio/narration.mp3' },
    },
    unused: {
      id: 'unused',
      filename: 'unused.png',
      mimeType: 'image/png',
      kind: 'image',
      path: 'assets/unused.png',
      byteLength: unused.byteLength,
      remote: { url: 'https://unused.example.com/never-requested.png' },
    },
  }
  project.network = {
    connectOrigins: ['wss://z-realtime.example.com:8443', 'https://api.example.com'],
  }
  project.media.audio.sounds.narration = {
    id: 'narration',
    name: '旁白',
    assetId: 'narration',
    channel: 'narration',
    defaultVolume: 1,
    defaultLoop: false,
  }
  const slide = project.surfaces.find((surface) => surface.type === 'slide')
  if (!slide || slide.type !== 'slide') throw new Error('expected slide surface')
  slide.scenes[0]!.backgroundAssetId = 'hero'
  courseProjectDocumentSchema.parse(project)
  return {
    project,
    assetFiles: { hero, narration, unused },
    components: {},
  }
}

function countedOnlineSources(): {
  sources: CoursePublishSources
  readCount(): number
} {
  const sources = onlineSources()
  let reads = 0
  const assetFiles = new Proxy(sources.assetFiles, {
    get(target, property, receiver) {
      if (property === 'hero' || property === 'narration') reads += 1
      return Reflect.get(target, property, receiver) as unknown
    },
  })
  return {
    sources: { ...sources, assetFiles },
    readCount: () => reads,
  }
}

function runtimeItem(
  id: string,
  source: string,
  enabled = true,
  order = 0,
): RuntimeLayerItem {
  return {
    kind: 'runtime',
    layerItemId: id,
    label: id,
    frame: { mode: 'absolute', x: 40, y: 40, width: 320, height: 180 },
    order,
    visible: true,
    locked: false,
    rotation: 0,
    opacity: 1,
    hitPolicy: 'auto',
    playbackInitialVisibility: 'inherit',
    runtime: {
      protocol: 'canvas-runtime',
      runtimeApiVersion: 2,
      enabled,
      renderMode: 'dom',
      source,
      content: { values: {} },
      assets: {},
    },
  }
}

function runtimeSources(source: string, enabled = true): CoursePublishSources {
  const project = createBlankCourseProject({
    now: NOW,
    includeDefaultController: false,
    controls: 'none',
  })
  const slide = project.surfaces.find((surface) => surface.type === 'slide')
  if (!slide || slide.type !== 'slide') throw new Error('expected slide surface')
  slide.scenes[0]!.layerItems.push(runtimeItem('network-runtime', source, enabled))
  return { project, assetFiles: {}, components: {} }
}

function onlineConnectReport(source: string) {
  const sources = runtimeSources(source)
  return collectCoursePackageExportPreflight(
    sources.project,
    'standalone-html',
    { assetFiles: {}, components: {} },
    PLAYER_BUNDLE,
    new Date('2026-08-17T00:00:00.000Z'),
    { singleHtmlMode: 'online-lightweight' },
  )
}

function assertRelativeManifest(paths: readonly string[]): void {
  for (const path of paths) {
    expect(path).not.toMatch(/^[A-Za-z]:/)
    expect(path.startsWith('/')).toBe(false)
    expect(path.includes('\\')).toBe(false)
  }
}

describe('course package export', () => {
  it('builds mixed Slide+Flow+Spatial standalone HTML and web package from one V2 producer', () => {
    const sources = mixedSources()
    const standalone = buildCoursePackages(sources, 'standalone-html', PLAYER_BUNDLE)
    const webPackage = buildCoursePackages(sources, 'web-package', PLAYER_BUNDLE)

    expect(publishedCourseV2Schema.parse(standalone.payload)).toEqual(standalone.payload)
    expect(standalone.payload).toEqual(webPackage.payload)
    expect(standalone.payload.surfaces.map((surface) => surface.type))
      .toEqual(['slide', 'flow', 'spatial-2d'])

    const html = strFromU8(standalone.files['index.html']!)
    expect(html).toContain('window.__H5_COURSE_PAYLOAD__=')
    expect(html).toContain('window.__COURSE_PLAYER_PLACEHOLDER__=true')
    expect(html).not.toMatch(/https?:\/\//)
    expect(html).not.toContain('.course-nav')
    assertRelativeManifest(standalone.manifest)

    const courseData = strFromU8(webPackage.files['course-data.js']!)
    const webIndex = strFromU8(webPackage.files['index.html']!)
    expect(courseData).toContain('window.__H5_COURSE_PAYLOAD__=')
    expect(courseData).not.toContain('data:image/')
    expect(webIndex).toContain("default-src 'none'")
    expect(webIndex).toContain("script-src 'self' 'unsafe-eval'")
    expect(webIndex).not.toMatch(/script-src[^;]*'unsafe-inline'/)
    expect(webIndex).toContain("style-src 'self' 'unsafe-inline'")
    expect(webIndex).toContain("connect-src 'self'")
    expect(html).toContain("script-src 'unsafe-inline' 'unsafe-eval' blob:")
    expect(html).toContain("style-src 'unsafe-inline'")
    expect(webPackage.manifest).toEqual(expect.arrayContaining([
      'index.html',
      'course-data.js',
      'player/player.css',
      'player/player.iife.js',
    ]))
    assertRelativeManifest(webPackage.manifest)
    expect(strFromU8(webPackage.files['player/player.css']!)).not.toContain('.course-nav')

    const archiveFiles = unzipSync(zipSync(webPackage.files))
    expect(Object.keys(archiveFiles).sort()).toEqual(webPackage.manifest.slice().sort())
  })

  it('keeps offline relative asset paths in the web package file graph', () => {
    const sources = mixedSources()
    const files = buildPublishedCourseWebPackageFiles(sources, PLAYER_BUNDLE)
    const html = buildPublishedCourseStandaloneHtml(sources, PLAYER_BUNDLE)

    expect(html).toContain('"format":"h5course-published"')
    expect(strFromU8(files['course-data.js']!)).toContain('"formatVersion":2')
    for (const path of Object.keys(files)) {
      expect(path.includes(':')).toBe(false)
      expect(path.startsWith('/')).toBe(false)
    }
  })

  it('does not rebuild the Published V2 payload inside the unified standalone facade', () => {
    const direct = countedOnlineSources()
    buildPublishedCourseStandaloneHtml(direct.sources, PLAYER_BUNDLE)

    const unified = countedOnlineSources()
    buildCoursePackages(unified.sources, 'standalone-html', PLAYER_BUNDLE)

    expect(direct.readCount()).toBeGreaterThan(0)
    expect(unified.readCount()).toBe(direct.readCount())
  })

  it('distinguishes offline-portable and online-lightweight standalone HTML without changing web packages', () => {
    const sources = onlineSources()
    const defaultOffline = buildCoursePackages(sources, 'standalone-html', PLAYER_BUNDLE)
    const explicitOffline = buildCoursePackages(sources, 'standalone-html', {
      playerBundle: PLAYER_BUNDLE,
      singleHtmlMode: 'offline-portable',
    })
    const online = buildCoursePackages(sources, 'standalone-html', {
      playerBundle: PLAYER_BUNDLE,
      singleHtmlMode: 'online-lightweight',
    })

    expect(defaultOffline.payload).toEqual(explicitOffline.payload)
    expect(defaultOffline.payload.assets.hero?.url).toMatch(/^data:image\/png;base64,/)
    expect(defaultOffline.payload.assets.narration?.url).toMatch(/^data:audio\/mpeg;base64,/)
    expect(online.payload.assets.hero?.url)
      .toBe('https://z-assets.example.com/course/hero.png?version=2')
    expect(online.payload.assets.narration?.url)
      .toBe('https://a-media.example.com/audio/narration.mp3')
    expect(online.payload.assets).not.toHaveProperty('unused')

    const onlineHtml = strFromU8(online.files['index.html']!)
    expect(onlineHtml).toContain('img-src data: blob: https://z-assets.example.com')
    expect(onlineHtml).toContain('media-src data: blob: https://a-media.example.com')
    expect(onlineHtml).toContain('font-src data:')
    expect(onlineHtml).toContain(
      'connect-src data: blob: https://api.example.com wss://z-realtime.example.com:8443',
    )
    expect(onlineHtml).not.toContain('https://unused.example.com')
    expect(onlineHtml.match(/script-src[^;]*/)?.[0]).not.toContain('https://')
    expect(onlineHtml.match(/Content-Security-Policy" content="([^"]+)/)?.[1]).not.toContain('*')

    const webFiles = buildPublishedCourseWebPackageFiles(sources, {
      playerBundle: PLAYER_BUNDLE,
      singleHtmlMode: 'online-lightweight',
    })
    const webData = strFromU8(webFiles['course-data.js']!)
    const webIndex = strFromU8(webFiles['index.html']!)
    expect(webData).toContain('./assets/')
    expect(webData).not.toContain('z-assets.example.com')
    expect(webData).not.toContain('a-media.example.com')
    expect(webIndex).toContain(
      "connect-src 'self' https://api.example.com wss://z-realtime.example.com:8443",
    )
  })

  it('lists only actual online remote dependencies in stable preflight order', () => {
    const sources = onlineSources()
    const online = collectCoursePackageExportPreflight(
      sources.project,
      'standalone-html',
      { assetFiles: sources.assetFiles, components: sources.components },
      PLAYER_BUNDLE,
      new Date('2026-08-17T00:00:00.000Z'),
      { singleHtmlMode: 'online-lightweight' },
    )
    const offline = collectCoursePackageExportPreflight(
      sources.project,
      'standalone-html',
      { assetFiles: sources.assetFiles, components: sources.components },
      PLAYER_BUNDLE,
      new Date('2026-08-17T00:00:00.000Z'),
      { singleHtmlMode: 'offline-portable' },
    )

    expect(online.summary).toMatchObject({ error: 0, info: 2, canExport: true })
    expect(online.items.map((item) => item.message)).toEqual([
      '在线轻量单 HTML 将依赖远程素材：https://a-media.example.com/audio/narration.mp3',
      '在线轻量单 HTML 将依赖远程素材：https://z-assets.example.com/course/hero.png?version=2',
    ])
    expect(offline.items).toEqual([])
  })

  it('accepts exact declared origins for the five supported connect APIs', () => {
    const sources = runtimeSources(`
      CoursewareRuntime.define({
        runtimeApiVersion: 2,
        create() {
          globalThis.fetch('HTTPS://API.EXAMPLE.COM:443/v1');
          new WebSocket('wss://socket.example.com:8443/live');
          new EventSource(\`https://events.example.com/stream\`);
          navigator.sendBeacon('https://beacon.example.com/collect', 'ok');
          const request = new XMLHttpRequest();
          request.open('GET', 'https://xhr.example.com/data');
          return { destroy() {} };
        }
      });
    `)
    sources.project.network = {
      connectOrigins: [
        'https://api.example.com',
        'wss://socket.example.com:8443',
        'https://events.example.com',
        'https://beacon.example.com',
        'https://xhr.example.com',
      ],
    }

    const report = collectCoursePackageExportPreflight(
      sources.project,
      'standalone-html',
      { assetFiles: {}, components: {} },
      PLAYER_BUNDLE,
      new Date('2026-08-17T00:00:00.000Z'),
      { singleHtmlMode: 'online-lightweight' },
    )

    expect(report.items.filter(({ code }) => code.startsWith('online-connect-'))).toEqual([])
    expect(report.summary.canExport).toBe(true)

    const webReport = collectCoursePackageExportPreflight(
      sources.project,
      'web-package',
      { assetFiles: {}, components: {} },
      PLAYER_BUNDLE,
      new Date('2026-08-17T00:00:00.000Z'),
    )
    expect(webReport.items.filter(({ code }) => code.startsWith('online-connect-'))).toEqual([])
    expect(webReport.summary.canExport).toBe(true)
    const webIndex = strFromU8(
      buildPublishedCourseWebPackageFiles(sources, PLAYER_BUNDLE)['index.html']!,
    )
    expect(webIndex).toContain(
      "connect-src 'self' https://api.example.com https://beacon.example.com https://events.example.com https://xhr.example.com wss://socket.example.com:8443",
    )
  })

  it('blocks an undeclared exact origin while keeping scheme and port matching exact', () => {
    const sources = runtimeSources(`
      CoursewareRuntime.define({runtimeApiVersion:2,create(){
        fetch('https://api.example.com:8443/v1');
        new WebSocket('wss://socket.example.com/live');
        return {destroy(){}};
      }});
    `)
    sources.project.network = {
      connectOrigins: ['https://api.example.com', 'https://socket.example.com'],
    }

    const report = collectCoursePackageExportPreflight(
      sources.project,
      'standalone-html',
      { assetFiles: {}, components: {} },
      PLAYER_BUNDLE,
      new Date('2026-08-17T00:00:00.000Z'),
      { singleHtmlMode: 'online-lightweight' },
    )

    expect(report.items.filter(({ code }) => code === 'online-connect-origin-undeclared'))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({
          severity: 'error',
          path: expect.arrayContaining(['runtime', 'source']),
          message: expect.stringContaining('https://api.example.com:8443'),
        }),
        expect.objectContaining({
          severity: 'error',
          message: expect.stringContaining('wss://socket.example.com'),
        }),
      ]))
    expect(report.summary.canExport).toBe(false)
  })

  it('fails closed with the same code and path in direct and unified online producers', () => {
    const sources = runtimeSources(`fetch('https://undeclared.example.com/data')`)
    const options = {
      playerBundle: PLAYER_BUNDLE,
      singleHtmlMode: 'online-lightweight' as const,
    }

    for (const produce of [
      () => buildPublishedCourseStandaloneHtml(sources, options),
      () => buildCoursePackages(sources, 'standalone-html', options),
      () => buildPublishedCourseWebPackageFiles(sources, PLAYER_BUNDLE),
      () => buildCoursePackages(sources, 'web-package', PLAYER_BUNDLE),
    ]) {
      let thrown: unknown
      try {
        produce()
      } catch (error) {
        thrown = error
      }
      expect(thrown).toBeInstanceOf(CoursePackagePreflightError)
      expect(thrown).toMatchObject({
        code: 'online-connect-origin-undeclared',
        path: expect.arrayContaining(['runtime', 'source']),
        report: expect.objectContaining({
          summary: expect.objectContaining({ canExport: false }),
        }),
      })
    }
  })

  it('warns for unresolved calls without treating comments, text, regex, or object methods as dependencies', () => {
    const sources = runtimeSources(String.raw`
      CoursewareRuntime.define({runtimeApiVersion:2,create(){
        // fetch('https://comment.example.com/ignored')
        const attribution = "WebSocket('wss://text.example.com/ignored')";
        const matcher = /fetch\("https:\/\/regex\.example\.com/;
        client.fetch('https://object.example.com/ignored');
        client.navigator.sendBeacon('https://object-beacon.example.com/ignored');
        scope.globalThis.fetch('https://nested-global.example.com/ignored');
        fetch(resolveEndpoint());
        return {destroy(){}};
      }});
    `)

    const report = collectCoursePackageExportPreflight(
      sources.project,
      'standalone-html',
      { assetFiles: {}, components: {} },
      PLAYER_BUNDLE,
      new Date('2026-08-17T00:00:00.000Z'),
      { singleHtmlMode: 'online-lightweight' },
    )

    expect(report.items.filter(({ code }) => code === 'online-connect-origin-undeclared')).toEqual([])
    expect(report.items.filter(({ code }) => code === 'online-connect-origin-unresolved'))
      .toEqual([expect.objectContaining({ severity: 'warning' })])
    expect(report.summary.canExport).toBe(true)
  })

  it('uses AST arguments for optional, computed, escaped, and XHR connect calls', () => {
    const report = onlineConnectReport([
      "fetch?.('https://optional.example/data')",
      "globalThis['fetch']('https://computed.example/data')",
      "new globalThis.WebSocket('wss://socket.example/live')",
      "globalThis.EventSource?.('https://events.example/stream')",
      "globalThis.navigator['sendBeacon']('https://beacon.example/collect')",
      'const request = new XMLHttpRequest()',
      "request['open'](`${debug(), 'GET'}`, 'https://xhr.example/data')",
      "fetch('https:\\x2f\\x2fescaped.example\\x2fdata')",
    ].join('\n'))

    const errors = report.items.filter(({ code }) => code === 'online-connect-origin-undeclared')
    expect(errors).toHaveLength(7)
    expect(errors.map(({ message }) => message)).toEqual(expect.arrayContaining([
      expect.stringContaining('https://optional.example'),
      expect.stringContaining('https://computed.example'),
      expect.stringContaining('wss://socket.example'),
      expect.stringContaining('https://events.example'),
      expect.stringContaining('https://beacon.example'),
      expect.stringContaining('https://xhr.example'),
      expect.stringContaining('https://escaped.example'),
    ]))
    expect(report.items.filter(({ code }) => code === 'online-connect-origin-unresolved')).toEqual([])
    expect(report.summary.canExport).toBe(false)
  })

  it('resolves shadows at each call site without mistaking regex or unrelated members for globals', () => {
    const report = onlineConnectReport(`
      fetch('https://real-global.example/data')
      function helper(fetch) { return fetch('https://parameter.example/local') }
      const arrow = fetch => fetch('https://arrow.example/local')
      function destructured() {
        const { fetch } = client
        fetch('https://destructured.example/local')
      }
      try { work() } catch (fetch) { fetch('https://catch.example/local') }
      function rooted(window, { navigator, XMLHttpRequest }) {
        window.fetch('https://window-param.example/local')
        navigator.sendBeacon('https://navigator-param.example/local')
        new XMLHttpRequest().open('GET', 'https://xhr-param.example/local')
      }
      if (enabled) /fetch('https:fake.example')/.test(text)
      client. /* member gap */ fetch('https://object.example/ignored')
      scope. globalThis.fetch('https://nested-global.example/ignored')
    `)

    const errors = report.items.filter(({ code }) => code === 'online-connect-origin-undeclared')
    expect(errors).toEqual([
      expect.objectContaining({ message: expect.stringContaining('https://real-global.example') }),
    ])
    expect(report.items.filter(({ code }) => code === 'online-connect-origin-unresolved'))
      .toEqual([expect.objectContaining({ severity: 'warning' })])
  })

  it('tracks XHR aliases by lexical binding identity and downgrades uncertain data flow', () => {
    const report = onlineConnectReport(`
      const request = new XMLHttpRequest()
      function nested(request) {
        request.open('GET', 'https://shadowed-xhr.example/local')
      }
      request.open('GET', 'https://real-xhr.example/data')
      const captured = new XMLHttpRequest()
      const later = () => captured.open('GET', 'https://captured-xhr.example/data')
      let mutable = new XMLHttpRequest()
      mutable.open('GET', 'https://mutable-xhr.example/data')
    `)

    expect(report.items.filter(({ code }) => code === 'online-connect-origin-undeclared'))
      .toEqual([
        expect.objectContaining({ message: expect.stringContaining('https://real-xhr.example') }),
      ])
    expect(report.items.filter(({ code }) => code === 'online-connect-origin-unresolved'))
      .toEqual([expect.objectContaining({ severity: 'warning' })])
  })

  it('warns once when module bindings, direct eval, or parse failure prevent a proof', () => {
    const moduleReport = onlineConnectReport(`
      import { fetch } from './client.js'
      fetch('https://module-local.example/data')
    `)
    const evalReport = onlineConnectReport(`eval("fetch('https://eval.example/data')")`)
    const globalEvalReport = onlineConnectReport(
      `globalThis.eval("fetch('https://global-eval.example/data')")`,
    )
    const functionReport = onlineConnectReport(
      `new Function("fetch('https://function.example/data')")()`,
    )
    const mutationReport = onlineConnectReport(`
      globalThis.navigator.sendBeacon = () => true
      globalThis.navigator.sendBeacon('https://mutated-beacon.example/data')
      XMLHttpRequest.prototype.open = () => undefined
      const localRequest = new XMLHttpRequest()
      localRequest.open('GET', 'https://mutated-xhr.example/data')
    `)
    const invalidReport = onlineConnectReport('fetch(')

    for (const report of [
      moduleReport,
      evalReport,
      globalEvalReport,
      functionReport,
      mutationReport,
      invalidReport,
    ]) {
      expect(report.items.filter(({ code }) => code === 'online-connect-origin-undeclared')).toEqual([])
      expect(report.items.filter(({ code }) => code === 'online-connect-origin-unresolved'))
        .toEqual([expect.objectContaining({ severity: 'warning' })])
      expect(report.summary.canExport).toBe(true)
    }
  })

  it('skips disabled Runtime and offline standalone, but validates web-package connect origins', () => {
    const sources = runtimeSources(
      `fetch('https://undeclared.example.com/data')`,
      false,
    )
    const onlineDisabled = collectCoursePackageExportPreflight(
      sources.project,
      'standalone-html',
      { assetFiles: {}, components: {} },
      PLAYER_BUNDLE,
      new Date('2026-08-17T00:00:00.000Z'),
      { singleHtmlMode: 'online-lightweight' },
    )
    const slide = sources.project.surfaces.find((surface) => surface.type === 'slide')
    if (!slide || slide.type !== 'slide') throw new Error('expected slide surface')
    const runtime = slide.scenes[0]!.layerItems[0]
    if (!runtime || runtime.kind !== 'runtime') throw new Error('expected Runtime')
    runtime.runtime.enabled = true
    const offline = collectCoursePackageExportPreflight(
      sources.project,
      'standalone-html',
      { assetFiles: {}, components: {} },
      PLAYER_BUNDLE,
      new Date('2026-08-17T00:00:00.000Z'),
      { singleHtmlMode: 'offline-portable' },
    )
    const web = collectCoursePackageExportPreflight(
      sources.project,
      'web-package',
      { assetFiles: {}, components: {} },
      PLAYER_BUNDLE,
      new Date('2026-08-17T00:00:00.000Z'),
    )

    expect(onlineDisabled.items.filter(({ code }) => code.startsWith('online-connect-'))).toEqual([])
    expect(offline.items.filter(({ code }) => code.startsWith('online-connect-'))).toEqual([])
    expect(web.items.filter(({ code }) => code === 'online-connect-origin-undeclared'))
      .toHaveLength(1)
  })

  it('scans only component packages that the Published payload actually references', () => {
    const fixture = listCourseProjectV9Fixtures().find(({ id }) => id === 'component')
    if (!fixture) throw new Error('component fixture is missing')
    const project = structuredClone(fixture.data.project)
    const [componentKey, componentFiles] = Object.entries(fixture.data.componentFiles)[0] ?? []
    if (!componentKey || !componentFiles) throw new Error('component fixture package is missing')
    const separator = componentKey.lastIndexOf('@')
    const component = parseComponentPackageFiles(componentFiles, {
      expectedId: componentKey.slice(0, separator),
      expectedVersion: componentKey.slice(separator + 1),
    })
    component.runtimeSource = `fetch('https://component-api.example.com/data')`

    const referenced = collectCoursePackageExportPreflight(
      project,
      'standalone-html',
      {
        assetFiles: fixture.data.assetFiles,
        components: { [component.manifest.id]: component },
      },
      PLAYER_BUNDLE,
      new Date('2026-08-17T00:00:00.000Z'),
      { singleHtmlMode: 'online-lightweight' },
    )
    expect(referenced.items).toContainEqual(expect.objectContaining({
      code: 'online-connect-origin-undeclared',
      path: expect.arrayContaining(['componentPackages', 'runtimePath']),
      message: expect.stringContaining('https://component-api.example.com'),
    }))

    const slide = project.surfaces.find((surface) => surface.type === 'slide')
    if (!slide || slide.type !== 'slide') throw new Error('component fixture slide is missing')
    slide.scenes.forEach((scene) => {
      scene.layerItems = scene.layerItems.filter((item) => item.kind !== 'component')
    })
    const unused = collectCoursePackageExportPreflight(
      project,
      'standalone-html',
      {
        assetFiles: fixture.data.assetFiles,
        components: { [component.manifest.id]: component },
      },
      PLAYER_BUNDLE,
      new Date('2026-08-17T00:00:00.000Z'),
      { singleHtmlMode: 'online-lightweight' },
    )
    expect(unused.items.filter(({ code }) => code.startsWith('online-connect-'))).toEqual([])
  })

  it('covers global, surface, Slide scene, and Spatial world Runtime owners', () => {
    const sources = mixedSources()
    const connectSource = (origin: string) => `fetch('${origin}/data')`
    sources.project.globalLayerItems.push({
      item: runtimeItem('global-network', connectSource('https://global.example.com'), true, 100),
      visibility: { mode: 'all', locationIds: [] },
    })
    const slide = sources.project.surfaces.find((surface) => surface.type === 'slide')
    const flow = sources.project.surfaces.find((surface) => surface.type === 'flow')
    const spatial = sources.project.surfaces.find((surface) => surface.type === 'spatial-2d')
    if (!slide || slide.type !== 'slide' || !flow || flow.type !== 'flow'
      || !spatial || spatial.type !== 'spatial-2d') {
      throw new Error('mixed Runtime owners are missing')
    }
    flow.surfaceLayerItems.push({
      item: runtimeItem('surface-network', connectSource('https://surface.example.com'), true, 101),
      visibility: { mode: 'all', locationIds: [] },
    })
    slide.scenes[0]!.layerItems.push(
      runtimeItem('scene-network', connectSource('https://scene.example.com'), true, 102),
    )
    spatial.world.layerItems.push(
      runtimeItem('world-network', connectSource('https://world.example.com'), true, 102),
    )
    courseProjectDocumentSchema.parse(sources.project)

    const report = collectCoursePackageExportPreflight(
      sources.project,
      'standalone-html',
      { assetFiles: {}, components: {} },
      PLAYER_BUNDLE,
      new Date('2026-08-17T00:00:00.000Z'),
      { singleHtmlMode: 'online-lightweight' },
    )
    const paths = report.items
      .filter(({ code }) => code === 'online-connect-origin-undeclared')
      .map(({ path }) => path)

    expect(paths).toHaveLength(4)
    expect(paths).toEqual(expect.arrayContaining([
      expect.arrayContaining(['globalLayerItems', 'runtime', 'source']),
      expect.arrayContaining(['surfaceLayerItems', 'runtime', 'source']),
      expect.arrayContaining(['scenes', 'layerItems', 'runtime', 'source']),
      expect.arrayContaining(['world', 'layerItems', 'runtime', 'source']),
    ]))
  })

  it('blocks an actual wildcard remote URL online before producing CSP while offline stays embedded', () => {
    const sources = onlineSources()
    sources.project.assets.hero!.remote = {
      url: 'https://*.example.com/course/hero.png',
    }
    const report = collectCoursePackageExportPreflight(
      sources.project,
      'standalone-html',
      { assetFiles: sources.assetFiles, components: sources.components },
      PLAYER_BUNDLE,
      new Date('2026-08-17T00:00:00.000Z'),
      { singleHtmlMode: 'online-lightweight' },
    )

    expect(report.summary.canExport).toBe(false)
    expect(report.items).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'online-remote-url-invalid',
      path: ['assets', 'hero', 'remote', 'url'],
      message: expect.stringContaining('https://*.example.com/course/hero.png'),
    }))
    expect(() => buildPublishedCourseStandaloneHtml(sources, {
      playerBundle: PLAYER_BUNDLE,
      singleHtmlMode: 'online-lightweight',
    })).toThrow(OnlineSingleHtmlDeliveryError)

    const offline = buildPublishedCourseStandaloneHtml(sources, PLAYER_BUNDLE)
    expect(offline).toContain('img-src data: blob:;')
    expect(offline).not.toContain('*.example.com')
  })

  it('lists an uppercase HTTPS dependency and normalizes its exact CSP origin', () => {
    const sources = onlineSources()
    sources.project.assets.hero!.remote = {
      url: 'HTTPS://CDN.EXAMPLE.COM/Course/Hero.png?Revision=7',
    }
    const report = collectCoursePackageExportPreflight(
      sources.project,
      'standalone-html',
      { assetFiles: sources.assetFiles, components: sources.components },
      PLAYER_BUNDLE,
      new Date('2026-08-17T00:00:00.000Z'),
      { singleHtmlMode: 'online-lightweight' },
    )
    const online = buildCoursePackages(sources, 'standalone-html', {
      playerBundle: PLAYER_BUNDLE,
      singleHtmlMode: 'online-lightweight',
    })
    const html = strFromU8(online.files['index.html']!)

    expect(report.items).toContainEqual(expect.objectContaining({
      severity: 'info',
      code: 'online-remote-asset',
      message: expect.stringContaining('HTTPS://CDN.EXAMPLE.COM/Course/Hero.png?Revision=7'),
    }))
    expect(report.summary.canExport).toBe(true)
    expect(online.payload.assets.hero?.url)
      .toBe('HTTPS://CDN.EXAMPLE.COM/Course/Hero.png?Revision=7')
    expect(html).toContain('img-src data: blob: https://cdn.example.com')
  })

  it('keeps remote dependency info when local bytes are missing', () => {
    const sources = onlineSources()
    const { hero: _missing, ...remainingAssetFiles } = sources.assetFiles
    const report = collectCoursePackageExportPreflight(
      sources.project,
      'standalone-html',
      { assetFiles: remainingAssetFiles, components: sources.components },
      PLAYER_BUNDLE,
      new Date('2026-08-17T00:00:00.000Z'),
      { singleHtmlMode: 'online-lightweight' },
    )

    expect(report.summary.canExport).toBe(false)
    expect(report.items).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'asset-bytes-missing',
      path: ['assets', 'hero'],
    }))
    expect(report.items).toContainEqual(expect.objectContaining({
      severity: 'info',
      code: 'online-remote-asset',
      message: expect.stringContaining('https://z-assets.example.com/course/hero.png?version=2'),
    }))
  })

  it('reports missing publish resources in Chinese preflight before export', () => {
    let project: CourseProjectDocument = createBlankCourseProject({
      now: NOW,
      includeDefaultController: false,
      controls: 'none',
    })
    project.assets.hero = {
      id: 'hero',
      filename: 'hero.png',
      mimeType: 'image/png',
      kind: 'image',
      path: 'assets/hero.png',
      byteLength: 4,
      width: 100,
      height: 100,
    }
    const slide = project.surfaces.find((surface) => surface.type === 'slide')
    if (!slide || slide.type !== 'slide') throw new Error('expected slide surface')
    slide.scenes[0]!.backgroundAssetId = 'hero'

    const report = collectCoursePackageExportPreflight(
      project,
      'web-package',
      { assetFiles: {}, components: {} },
      PLAYER_BUNDLE,
      new Date('2026-08-17T00:00:00.000Z'),
    )

    expect(report.items).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'asset-bytes-missing',
      message: expect.stringContaining('hero.png'),
    }))
    expect(report.summary.canExport).toBe(false)
    expect(report.generatedAt).toBe('2026-08-17T00:00:00.000Z')

    const byteLengthReport = collectCoursePackageExportPreflight(
      project,
      'web-package',
      { assetFiles: { hero: new Uint8Array([1, 2, 3]) }, components: {} },
      PLAYER_BUNDLE,
      new Date('2026-08-17T00:00:00.000Z'),
    )
    expect(byteLengthReport.items).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'asset-byte-length-mismatch',
      path: ['assets', 'hero', 'byteLength'],
    }))

    delete project.assets.hero
    const metadataReport = collectCoursePackageExportPreflight(
      project,
      'web-package',
      { assetFiles: {}, components: {} },
      PLAYER_BUNDLE,
      new Date('2026-08-17T00:00:00.000Z'),
    )
    expect(metadataReport.items).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'asset-metadata-missing',
      path: ['assets', 'hero'],
    }))
  })

  it('embeds a Published V2 payload and matching CoursePlayer bundle in the web package', () => {
    const sources = mixedSources()
    const files = buildPublishedCourseWebPackageFiles(sources, PLAYER_BUNDLE)
    const courseData = strFromU8(files['course-data.js']!)
    const assignment = 'window.__H5_COURSE_PAYLOAD__='
    expect(courseData.startsWith(assignment)).toBe(true)
    const payload = publishedCourseV2Schema.parse(JSON.parse(
      courseData.slice(assignment.length).replace(/;\s*$/, ''),
    ))
    expect(payload.format).toBe('h5course-published')
    expect(payload.formatVersion).toBe(2)
    expect(payload.sourceSchemaVersion).toBe(9)
    expect(courseData).not.toContain('__H5_LESSON_PAYLOAD__')
    expect(courseData).not.toContain('"schemaVersion":8')
    expect(strFromU8(files['player/player.iife.js']!)).toBe(PLAYER_BUNDLE)
    expect(strFromU8(files['index.html']!)).toContain('id="course-root"')
    expect(strFromU8(files['index.html']!)).not.toContain('lesson-root')
  })

  it('fails loud when the matching CoursePlayer bundle is empty', () => {
    const sources = mixedSources()
    const emptyBundle = '   '
    expect(() => buildPublishedCourseStandaloneHtml(sources, '')).toThrow('Player Runtime 为空')
    expect(() => buildPublishedCourseStandaloneHtml(sources, emptyBundle)).toThrow('Player Runtime 为空')
    expect(() => buildPublishedCourseWebPackageFiles(sources, '')).toThrow('Player Runtime 为空')
    expect(() => buildCoursePackages(sources, 'web-package', emptyBundle)).toThrow('Player Runtime 为空')
    expect(() => buildCoursePackages(sources, 'standalone-html', {
      playerBundle: '',
      singleHtmlMode: 'online-lightweight',
    })).toThrow('Player Runtime 为空')

    const report = collectCoursePackageExportPreflight(
      sources.project,
      'web-package',
      { assetFiles: {}, components: {} },
      '',
      new Date('2026-08-17T00:00:00.000Z'),
    )
    expect(report.items).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'player-bundle-empty',
    }))
    expect(report.summary.canExport).toBe(false)
  })

  it('escapes title HTML, script terminators, and remote URLs in standalone HTML', () => {
    const sources = mixedSources()
    sources.project.title = '离线课件 </title><script>bad()</script>'
    const html = buildPublishedCourseStandaloneHtml(
      sources,
      "window.__PLAYER_STARTED__=true;const marker='</script>';const info='https://example.invalid';",
    )

    expect(html.startsWith('<!doctype html>')).toBe(true)
    expect(html).toContain('id="course-root"')
    expect(html).not.toContain('<script src=')
    expect(html).not.toContain('<link rel="stylesheet"')
    expect(html).not.toMatch(/https?:\/\//i)
    expect(html).not.toContain('<title>离线课件 </title>')
    expect(html).toContain('&lt;/title&gt;&lt;script&gt;bad()&lt;/script&gt;')
    expect(html).toContain('<\\/script>')
    expect(html).toContain('connect-src data: blob:')
    expect(html).not.toMatch(/connect-src[^;]*(?:https?:|\*|'self')/i)
    expect(html).toContain('window.__H5_COURSE_PAYLOAD__=')
    expect(html).toContain('"format":"h5course-published"')
    expect(html).toContain('"formatVersion":2')
  })

  it('fails closed before every public standalone and web package emitter', async () => {
    const project = createBlankCourseProject({
      now: NOW,
      includeDefaultController: false,
      controls: 'none',
    })
    project.assets.hero = {
      id: 'hero',
      filename: 'hero.png',
      mimeType: 'image/png',
      kind: 'image',
      path: 'assets/hero.png',
      byteLength: 4,
    }
    const slide = project.surfaces.find((surface) => surface.type === 'slide')
    if (!slide || slide.type !== 'slide') throw new Error('expected slide surface')
    slide.scenes[0]!.backgroundAssetId = 'hero'
    courseProjectDocumentSchema.parse(project)

    const sources = { project, assetFiles: {}, components: {} }
    const producers: ReadonlyArray<readonly [string, () => unknown]> = [
      ['standalone direct', () => buildPublishedCourseStandaloneHtml(sources, PLAYER_BUNDLE)],
      ['standalone unified', () => buildCoursePackages(
        sources,
        'standalone-html',
        PLAYER_BUNDLE,
      )],
      ['web files', () => buildPublishedCourseWebPackageFiles(sources, PLAYER_BUNDLE)],
      ['web sync zip', () => buildPublishedCourseWebPackage(sources, PLAYER_BUNDLE)],
      ['web async zip', () => buildPublishedCourseWebPackageAsync(sources, PLAYER_BUNDLE)],
      ['web unified', () => buildCoursePackages(sources, 'web-package', PLAYER_BUNDLE)],
    ]

    for (const [label, produce] of producers) {
      await expect(Promise.resolve().then(produce), label).rejects.toMatchObject({
        name: 'CoursePackagePreflightError',
        code: 'asset-bytes-missing',
        path: ['assets', 'hero'],
        report: expect.objectContaining({
          summary: expect.objectContaining({ canExport: false }),
        }),
      })
    }
  })

  it('keeps web-package ZIP paths and asset URLs inside the package root', () => {
    const sources = mixedSources()
    const zipBytes = buildPublishedCourseWebPackage(sources, PLAYER_BUNDLE)
    expect([...zipBytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04])

    const files = buildPublishedCourseWebPackageFiles(sources, PLAYER_BUNDLE)
    const html = strFromU8(files['index.html']!)
    expect(html).toContain('src="./course-data.js"')
    expect(html).toContain('src="./player/player.iife.js"')
    expect(html).toContain('href="./player/player.css"')
    expect(html).not.toMatch(/https?:\/\//i)
    expect(html).toContain("connect-src 'self'")
    expect(html).not.toMatch(/connect-src[^;]*(?:https?:|\*)/i)

    for (const archivePath of Object.keys(files)) {
      expect(archivePath).not.toMatch(/^(?:[A-Za-z]:|\/|\\)/)
      expect(archivePath).not.toContain('\\')
      expect(archivePath.split('/')).not.toContain('..')
      expect(archivePath.split('/')).not.toContain('.')
    }
    const assignment = 'window.__H5_COURSE_PAYLOAD__='
    const courseText = strFromU8(files['course-data.js']!)
    const payload = publishedCourseV2Schema.parse(JSON.parse(
      courseText.slice(assignment.length).replace(/;\s*$/, ''),
    ))
    const urls = Object.values(payload.assets).map((asset) => asset.url)
    for (const url of urls) {
      expect(url).toMatch(/^\.\/[A-Za-z0-9._/-]+$/)
      expect(url.split('/')).not.toContain('..')
    }
  })

  it('embeds Canvas Runtime source as UTF-16LE and refuses a missing runtime asset', () => {
    const fixture = listCourseProjectV9Fixtures().find(({ id }) => id === 'canvas-runtime')
    if (!fixture) throw new Error('missing canvas-runtime fixture')
    const sources = {
      project: structuredClone(fixture.data.project),
      assetFiles: { ...fixture.data.assetFiles },
      components: {},
    }
    const runtimeSource = (() => {
      const slide = sources.project.surfaces.find((surface) => surface.type === 'slide')
      const item = slide?.type === 'slide'
        ? slide.scenes[0]?.layerItems.find((candidate) => candidate.kind === 'runtime')
        : undefined
      if (!item || item.kind !== 'runtime') throw new Error('expected canvas runtime')
      return item.runtime.source
    })()

    const published = buildPublishedCourseV2Payload(sources)
    const publishedSlide = published.surfaces.find((surface) => surface.type === 'slide')
    const runtime = publishedSlide?.type === 'slide'
      ? publishedSlide.scenes[0]?.layerItems.find((item) => item.kind === 'runtime')
      : undefined
    if (!runtime || runtime.kind !== 'runtime') throw new Error('expected published runtime')
    expect(runtime.runtime).not.toHaveProperty('source')
    expect(decodePublishedCode(runtime.runtime.code)).toBe(runtimeSource)

    const html = buildPublishedCourseStandaloneHtml(sources, PLAYER_BUNDLE)
    expect(html).toContain('window.__H5_COURSE_PAYLOAD__=')
    expect(html).not.toContain(runtimeSource)

    const files = buildPublishedCourseWebPackageFiles(sources, PLAYER_BUNDLE)
    const assignment = 'window.__H5_COURSE_PAYLOAD__='
    const packaged = publishedCourseV2Schema.parse(JSON.parse(
      strFromU8(files['course-data.js']!).slice(assignment.length).replace(/;\s*$/, ''),
    ))
    for (const asset of Object.values(packaged.assets)) {
      expect(asset.url).toMatch(/^\.\/assets\//)
      expect(asset.url).not.toContain('data:')
    }

    delete sources.assetFiles['runtime-sprite']
    expect(() => buildPublishedCourseStandaloneHtml(sources, PLAYER_BUNDLE))
      .toThrow(/没有可嵌入导出物的本地字节/)
  })
})
