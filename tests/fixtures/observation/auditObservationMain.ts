import { app, BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { DocumentHostService } from '../../../src/main/workbench/DocumentHostService'
import { registerPrivilegedSchemes } from '../../../src/main/protocols'
import { ViewObservationDesktopService } from '../../../src/main/workbench/observation/ViewObservationDesktopService'
import { ViewObservationService } from '../../../src/main/workbench/observation/ViewObservationService'
import { ObservationImageStore } from '../../../src/main/workbench/observation/ObservationImageStore'
import { createBlankCourseProjectV10 } from '../../../src/core/course/createCourseProjectV10'
import { WEB_DEFINITION } from '../../../src/components/web/data'
import { componentProjectFiles } from '../../../src/core/projectFiles/componentPlatform'
import { captureComponentOperation } from '../../../src/core/drivers/courseV10Operations'
import { buildPublishedCourseV3 } from '../../../src/core/publish/componentPlatform'
import { auditProgramActions } from './auditProgramActions'
import { createAuditOutputCaptureHost } from './auditOutputCaptureHost'

const directory = process.env.OBSERVATION_AUDIT_ROOT!
app.setPath('userData', join(directory, 'profile'))
registerPrivilegedSchemes()
app.commandLine.appendSwitch('disable-background-timer-throttling')
app.whenReady().then(() => {
  ;(globalThis as any).__guolingAuditStartup?.('app-ready')
  const driver = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } })
  ;(globalThis as any).__guolingAuditStartup?.('driver-created')
  void driver.loadURL('data:text/html,Observation%20driver').then(() => (globalThis as any).__guolingAuditStartup?.('driver-loaded'))
  ;(globalThis as any).runObservationAudit = async () => {
    const host = new DocumentHostService(join(directory, 'recovery'))
    const desktop = new ViewObservationDesktopService({ rendererEntryUrl: process.env.OBSERVATION_AUDIT_URL!, compilation: host.compilation })
    const images = new ObservationImageStore()
    const service = new ViewObservationService({ snapshot: host.internalAPI.read, captureIsolated: desktop.captureIsolated, images })
    host.tools.configureHostServices({ observations: service })
    const project = createBlankCourseProjectV10('Observation target proof')
    project.definitions[WEB_DEFINITION.id] = WEB_DEFINITION
    const html = (text: string, color: string) => `<div style="height:100%;display:grid;place-items:center;background:${color};color:white;font:700 64px sans-serif">${text}</div>`
    const first = project.instances[project.rootIds[0]]
    first.name = 'FIRST RED'; first.childIds = ['red-content']; first.container!.designSize = { width: 800, height: 450 }
    project.instances.second = { ...structuredClone(first), id: 'second', name: 'SECOND BLUE', childIds: ['blue-content'] }
    project.rootIds.push('second')
    project.definitions.program = { id: 'program', role: 'content', implementation: { kind: 'builtin', key: 'guoling.html-program' } }
    project.instances['program-root'] = { id: 'program-root', definitionId: 'program', name: 'PROGRAM ROOT', data: {
      html: `<main style="min-height:100vh;display:grid;place-items:center;background:#164e63;color:white;font:700 56px sans-serif"><button id="advance" onclick="window.count++;this.textContent='继续实验（'+window.count+'）';document.getElementById('count').textContent=String(window.count)">继续实验（0）</button><output id="count">0</output></main><script>window.count=0</script>`,
    } }
    project.rootIds.push('program-root')
    for (const [id, text, color] of [['red-content', 'FIRST RED', '#b91c1c'], ['blue-content', 'SECOND BLUE', '#1d4ed8']]) {
      project.instances[id] = { id, definitionId: WEB_DEFINITION.id, data: { html: html(text, color) }, frame: { width: 800, height: 450, transform: [1, 0, 0, 1, 0, 0] } }
    }
    const opened = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'observe.h5lesson')
    const runId = 'observation-audit'
    await host.tools.beginRun({ runId, actor: 'agent', documents: [{ documentId: opened.documentId, writable: [{ kind: 'document' }] }], fileAccess: { permission: 'workspace', workspaceRoot: directory } })
    await host.tools.loadToolFamilies(runId, ['content'])
    const observations: unknown[] = []
    const observe = async (surfaceId: string, name: string) => {
      const snapshot = await host.internalAPI.read(opened.documentId)
      if (snapshot.model.kind !== 'course-v10') throw new Error('Expected V10')
      const file = componentProjectFiles(snapshot.model.project, snapshot.model.resources).find(file =>
        file.kind === 'structure' && file.target?.kind === 'container' && file.target.container.kind === 'surface' && file.target.container.surfaceId === surfaceId
        || file.kind === 'html' && file.target?.kind === 'instance' && file.target.instanceId === surfaceId)
      if (!file) throw new Error(`Observation path unavailable: ${surfaceId}`)
      const result = await host.tools.execute(runId, name, { name: 'view.observe', input: { path: file.path } })
      if (result.kind !== 'read') throw new Error(JSON.stringify(result))
      const data = result.data as any
      const resource = await service.readResource({ runId, resourceId: data.image.resourceId })
      await writeFile(join(directory, `${name}.png`), resource.bytes)
      observations.push({ name, path: file.path, ...data, windowCount: BrowserWindow.getAllWindows().length })
    }
    try {
      await observe('second', '01-second-blue')
      await observe(first.id, '02-first-red')
      const before = await host.internalAPI.read(opened.documentId)
      if (before.model.kind !== 'course-v10') throw new Error('Expected V10')
      const commit = await host.internalAPI.dispatch({ documentId: opened.documentId, epoch: opened.epoch, baseRevision: before.revision,
        operationId: 'change-blue', requestDigest: 'observation-audit-change', actor: 'human', mutation: { type: 'command', command:
          captureComponentOperation(before.model.project, [{ type: 'data.set', instanceId: 'blue-content', path: ['html'], value: html('SECOND GREEN UPDATED', '#15803d') }]) } })
      if (commit.status !== 'applied') throw new Error(JSON.stringify(commit))
      await observe('second', '03-second-green-updated')
      await observe('program-root', '04-program-root')
      const final = await host.internalAPI.read(opened.documentId)
      if (final.model.kind !== 'course-v10') throw new Error('Expected component project')
      const publication = await buildPublishedCourseV3({ project: final.model.project, assetBytes: final.model.resources.assets,
        componentFiles: final.model.resources.components }, { compilation: host.compilation,
        assetUrl: (asset, bytes) => `data:${asset.mimeType ?? 'application/octet-stream'};base64,${Buffer.from(bytes).toString('base64')}` })
      // Exercise the output owner's public captureSurface entry as well as the
      // observation worker. Main supplies real pixels at the requested region.
      const captureHost = createAuditOutputCaptureHost(process.env.OBSERVATION_AUDIT_URL!)
      const captureWindow = captureHost.window
      const captureDiagnostics: unknown[] = []
      captureWindow.webContents.on('console-message', event => {
        if (captureDiagnostics.length < 50) captureDiagnostics.push({ type: 'console', level: event.level,
          message: event.message.slice(0, 1800), source: event.sourceId.slice(0, 400), line: event.lineNumber })
      })
      captureWindow.webContents.on('did-fail-load', (_event, code, message, url, mainFrame) => {
        captureDiagnostics.push({ type: 'load-failure', code, message, url: url.slice(0, 400), mainFrame })
      })
      let programOutput: { cssRect: { x: number; y: number; width: number; height: number }; devicePixelRatio: number;
        pngSize: { width: number; height: number }; resultSize: { width: number; height: number } }
      try {
        await captureHost.load()
        const captureModule = new URL('src/player/componentPlatform/outputCapture.ts', process.env.OBSERVATION_AUDIT_URL!).href
        await captureWindow.webContents.executeJavaScript(`(async () => {
          window.__capturePhase = 'import'; window.__captureErrors = [];
          addEventListener('error', event => window.__captureErrors.push(String(event.error ?? event.message)));
          addEventListener('unhandledrejection', event => window.__captureErrors.push(String(event.reason)));
          requestAnimationFrame(() => requestAnimationFrame(() => { window.__capturePaintReady = true; }));
          const { prepareComponentOutputCapture } = await import(${JSON.stringify(captureModule)});
          const root = document.createElement('div');
          Object.assign(root.style, { position: 'fixed', inset: '0', width: '640px', height: '360px' });
          document.body.replaceChildren(root);
          window.__capturePhase = 'prepare';
          const bootstrapBaseUrl = ${JSON.stringify(captureHost.bootstrapBaseUrl)};
          const componentBootstrap = {
            async createComponentBootstrap({leaseId, html}) {
              const url = new URL(encodeURIComponent(leaseId), bootstrapBaseUrl);
              const response = await fetch(url, {method:'POST',body:html,credentials:'omit',headers:{'Content-Type':'text/plain;charset=UTF-8'}});
              if (!response.ok) throw new Error('Output bootstrap preparation failed: '+response.status);
              return {leaseId,url:url.href};
            },
            async releaseComponentBootstrap({leaseId}) {
              const response = await fetch(new URL(encodeURIComponent(leaseId), bootstrapBaseUrl), {method:'DELETE',credentials:'omit'});
              if (!response.ok) throw new Error('Output bootstrap release failed: '+response.status);
            },
          };
          const capture = await prepareComponentOutputCapture({ payload: ${JSON.stringify(publication.payload)}, root, componentBootstrap,
            screenshot: rect => new Promise(resolve => { window.__capturePhase = 'screenshot'; window.__captureRegion = rect; window.__finishCapture = resolve; }) });
          window.__capturePhase = 'captureSurface';
          window.__captureResult = capture.captureSurface('program-root').finally(() => capture.dispose());
          window.__captureResult.catch(error => { window.__captureFailure = String(error); });
        })()`)
        const deadline = Date.now() + 20_000
        let region: { x: number; y: number; width: number; height: number } | undefined
        while (!region) {
          const pending = await captureWindow.webContents.executeJavaScript('({ region: window.__captureRegion, failure: window.__captureFailure })')
          if (pending.failure) throw new Error(pending.failure)
          region = pending.region
          if (region) break
          if (Date.now() >= deadline) throw new Error('Program output did not become ready')
          await new Promise(resolve => setTimeout(resolve, 25))
        }
        const bitmap = await captureWindow.webContents.capturePage({ x: Math.floor(region.x), y: Math.floor(region.y),
          width: Math.ceil(region.width), height: Math.ceil(region.height) })
        if (bitmap.isEmpty()) throw new Error('Program output pixels were empty')
        // The output owner requests CSS coordinates and returns the image its
        // screenshot port supplies. Preserve real HiDPI pixels. NativeImage's
        // getSize semantics differ across Electron versions; the PNG IHDR is
        // the authoritative dimensions of the bytes supplied to this port.
        const png = bitmap.toPNG(), pngSize = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) }
        await writeFile(join(directory, '05-program-output.png'), png)
        const devicePixelRatio = await captureWindow.webContents.executeJavaScript('window.devicePixelRatio') as number
        await captureWindow.webContents.executeJavaScript(`window.__finishCapture(${JSON.stringify({ dataUrl: `data:image/png;base64,${png.toString('base64')}`, ...pngSize })})`)
        const resultSize = await captureWindow.webContents.executeJavaScript('window.__captureResult.then(({width, height}) => ({width, height}))')
        programOutput = { cssRect: region, devicePixelRatio, pngSize, resultSize }
      } catch (error) {
        const renderer = await captureWindow.webContents.executeJavaScript(`({phase:window.__capturePhase,
          failure:window.__captureFailure,errors:window.__captureErrors,paintReady:window.__capturePaintReady,
          visibility:document.visibilityState,body:document.body.innerHTML.slice(0,3500),
          frames:Array.from(document.querySelectorAll('iframe')).map(frame=>({src:frame.src.slice(0,400),
            sandbox:frame.getAttribute('sandbox'),rect:frame.getBoundingClientRect().toJSON()}))})`).catch(value => ({ error: String(value) }))
        const frames = captureWindow.webContents.mainFrame.framesInSubtree.map(frame => ({ url: frame.url.slice(0, 400),
          detached: frame.detached, processId: frame.processId, frameToken: frame.frameToken }))
        await writeFile(join(directory, '05-output-diagnostics.json'), JSON.stringify({ error: String(error), renderer, frames, console: captureDiagnostics }, null, 2))
        throw error
      } finally { await captureHost.close() }
      const interactive = await auditProgramActions(directory, process.env.OBSERVATION_AUDIT_URL!, final.model)
      const result = { observations, commit, programOutput, interactive, electron: process.versions.electron, chrome: process.versions.chrome, windowCount: BrowserWindow.getAllWindows().length, modelCalls: 0 }
      await writeFile(join(directory, 'result.json'), JSON.stringify(result, null, 2))
      return result
    } finally { await host.tools.stop(runId); await host.operate({ type: 'close', documentId: opened.documentId, discardDirty: true }) }
  }
})
