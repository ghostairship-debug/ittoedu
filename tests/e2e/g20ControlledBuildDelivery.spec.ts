import { _electron as electron, chromium, expect, test, type ElectronApplication } from '@playwright/test'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type ServerResponse } from 'node:http'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { extractFile } from '@electron/asar'
import { zipSync } from 'fflate'
import sharp from 'sharp'
import { createCourseProjectArchive, openCourseProjectArchive } from '../../src/core/drivers/codecs/courseProjectArchive'
import { componentPackageKey } from '../../src/core/drivers/codecs/archivePath'
import { importComponentPackage } from '../../src/core/drivers/codecs/importComponentPackage'
import { BACKGROUND_E2E_ENV } from '../../src/main/windowVisibility'
import { courseProjectDocumentSchema } from '../../src/shared/courseProjectSchema'
import type { RuntimeLayerItem } from '../../src/shared/courseProjectTypes'
import { collectFileArtifactEvidence, readAsarPackageMetadata } from '../../scripts/releaseArtifactEvidence'

const root = resolve(__dirname, '../..')
const packageId = 'com.example.s13-external-delivery', packageVersion = '1.0.0', instanceId = 's13-delivery-external-component'
const packageKey = componentPackageKey(packageId, packageVersion)
const runtimePath = `components/${packageId}@${packageVersion}/runtime.js`
const componentSource = `window.CoursewareComponent.define({
  id:'${packageId}',runtimeApiVersion:4,
  create:function(ctx){
    var button=document.createElement('button');button.type='button';button.textContent='显示答案';
    button.style.cssText='pointer-events:auto;width:100%;min-height:72px;border:0;border-radius:14px;background:#075985;color:white;font:28px sans-serif;cursor:pointer';
    var answer=document.createElement('p');answer.textContent='答案尚未显示';answer.style.cssText='font:24px sans-serif;color:#172554';
    button.onclick=function(){answer.textContent='正确答案：受控导入并离线播放。'};
    ctx.dom.root.style.pointerEvents='auto';ctx.dom.root.replaceChildren(button,answer);
    return {update:function(){},resize:function(){},suspend:function(){},resume:function(){},destroy:function(){button.onclick=null;ctx.dom.root.replaceChildren()}};
  }
});`

function runtimeItem(): RuntimeLayerItem {
  return {
    kind: 'runtime', layerItemId: 's13-delivery-runtime', label: '离线 Runtime',
    frame: { mode: 'absolute', x: 80, y: 320, width: 430, height: 140 }, order: 20,
    visible: true, locked: false, rotation: 0, opacity: 1, hitPolicy: 'auto', playbackInitialVisibility: 'inherit',
    runtime: {
      protocol: 'surface-runtime', runtimeApiVersion: 3, enabled: true, renderMode: 'dom',
      content: { values: {} }, assets: {},
      source: `CoursewareRuntime.define({protocol:'surface-runtime',runtimeApiVersion:3,create(ctx){
        var button=document.createElement('button');var count=0;button.type='button';
        button.dataset.s13DeliveryRuntime='true';button.textContent='Runtime 次数：0';
        button.style.cssText='width:100%;height:100%;font:28px sans-serif;cursor:pointer';
        var click=function(){button.textContent='Runtime 次数：'+(++count)};
        button.addEventListener('click',click);ctx.dom.root.appendChild(button);
        return {destroy(){button.removeEventListener('click',click);button.remove()}};
      }});`,
    },
  }
}

const sse = (id: string, delta: unknown, finish: string | null = null) => `data: ${JSON.stringify({ id, model: 'fixture-s13-delivery',
  choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`
const toolResults = (payload: any) => payload.messages.filter((message: any) => message.role === 'tool').map((message: any) => JSON.parse(message.content))
const wire = (payload: any, description: string) => {
  const tool = payload.tools.find((item: any) => item.function.description.startsWith(description))
  if (!tool) throw new Error(`Missing advertised tool: ${description}`)
  return tool.function.name as string
}
function call(response: ServerResponse, id: string, calls: Array<{ id: string; name: string; input: unknown }>) {
  response.write(sse(id, { role: 'assistant', tool_calls: calls.map((item, index) => ({ index, id: item.id, type: 'function',
    function: { name: item.name, arguments: JSON.stringify(item.input) } })) }, 'tool_calls'))
  response.end('data: [DONE]\n\n')
}

test('S13-T06 controlled Component import survives History and reopen, then Component and Runtime play in offline HTML', async ({}, info) => {
  test.setTimeout(300_000)
  const output = join(root, 'output/g20/s13-delivery'); mkdirSync(output, { recursive: true })
  const directory = mkdtempSync(join(output, 'run-')), workspace = join(directory, 'workspace'); mkdirSync(workspace)
  const coursePath = join(workspace, '受控交付课件.h5lesson'), htmlPath = join(directory, '受控交付离线.html')
  const externalPackagePath = join(directory, '外部互动测验.h5component')
  const sourceArchive = openCourseProjectArchive(new Uint8Array(readFileSync(join(root, 'tests/fixtures/course-project-v9/component.h5lesson'))))
  const project = structuredClone(sourceArchive.project), slide = project.surfaces[0]
  if (slide?.type !== 'slide') throw new Error('Expected Slide component fixture')
  const oldPackageId = 'com.example.v9-quiz', oldPackageKey = componentPackageKey(oldPackageId, '4.0.0')
  const oldItem = slide.scenes[0]!.layerItems.find(item => item.kind === 'component' && item.layerItemId === 'slide-quiz')
  const templateFiles = sourceArchive.componentFiles[oldPackageKey]
  if (oldItem?.kind !== 'component' || !templateFiles?.['manifest.json'] || !templateFiles['thumbnail.png']) {
    throw new Error('Expected complete Component fixture template')
  }
  slide.scenes[0]!.layerItems = slide.scenes[0]!.layerItems.filter(item => item.layerItemId !== oldItem.layerItemId)
  delete project.componentPackages[oldPackageId]
  slide.scenes[0]!.layerItems.push(runtimeItem())
  const fallback = new Uint8Array(await sharp({ create: { width: 400, height: 240, channels: 4, background: '#dbeafe' } }).png().toBuffer())
  const fallbackMeta = project.assets['quiz-fallback']
  if (fallbackMeta?.kind !== 'image') throw new Error('Expected fallback image metadata')
  project.assets['quiz-fallback'] = { ...fallbackMeta, mimeType: 'image/png', byteLength: fallback.byteLength, width: 400, height: 240 }
  const baseline = courseProjectDocumentSchema.parse(project)
  const assetFiles = { ...sourceArchive.assetFiles, 'quiz-fallback': fallback }
  const baselineComponentFiles = { ...sourceArchive.componentFiles }
  delete baselineComponentFiles[oldPackageKey]
  expect(baseline.componentPackages[packageId]).toBeUndefined()
  expect(baselineComponentFiles[packageKey]).toBeUndefined()
  expect(slide.scenes[0]!.layerItems.some(item => item.layerItemId === instanceId)).toBe(false)
  writeFileSync(coursePath, createCourseProjectArchive({ project: baseline, assetFiles, componentFiles: baselineComponentFiles }))

  const manifest = JSON.parse(new TextDecoder().decode(templateFiles['manifest.json'])) as Record<string, unknown>
  const externalFiles = {
    'manifest.json': new TextEncoder().encode(JSON.stringify({ ...manifest, id: packageId, version: packageVersion, name: 'S13 外部互动测验' })),
    'runtime.js': new TextEncoder().encode(componentSource),
    'thumbnail.png': templateFiles['thumbnail.png'],
  }
  writeFileSync(externalPackagePath, zipSync(externalFiles))
  const externalPackageBytes = new Uint8Array(readFileSync(externalPackagePath))
  const externalPackageSha256 = createHash('sha256').update(externalPackageBytes).digest('hex')
  const externalPackage = importComponentPackage(externalPackageBytes, { expectedId: packageId, expectedVersion: packageVersion,
    provenance: { sha256: externalPackageSha256, importedAt: new Date().toISOString(), sourceLabel: 'S13 外部互动测验.h5component' } })
  expect(externalPackage.key).toBe(packageKey)
  expect(Object.keys(externalPackage.files).sort()).toEqual(['manifest.json', 'runtime.js', 'thumbnail.png'])
  const candidateHash = externalPackage.contentSha256
  const candidateProject = structuredClone(baseline)
  candidateProject.componentPackages[packageId] = externalPackage.metadata
  const candidateSlide = candidateProject.surfaces[0]
  if (candidateSlide?.type !== 'slide') throw new Error('Expected candidate Slide')
  const candidateItems = candidateSlide.scenes[0]!.layerItems
  const insertionIndex = candidateItems.findIndex(item => item.order > oldItem.order)
  candidateItems.splice(insertionIndex < 0 ? candidateItems.length : insertionIndex, 0,
    { ...structuredClone(oldItem), layerItemId: instanceId, label: '外部互动测验',
      component: { packageId, version: packageVersion } })
  const validatedCandidate = courseProjectDocumentSchema.parse(candidateProject)

  const requests: any[] = [], serverErrors: string[] = [], observedTools: string[] = []
  let requestNumber = 0, job = '', artifact = ''
  let releaseImport!: () => void
  const importGate = new Promise<void>(resolve => { releaseImport = resolve })
  let beforeImport: Record<string, unknown> | null = null
  const server = createServer(async (request, response) => {
    try {
      let body = ''; for await (const chunk of request) body += chunk.toString()
      const payload = JSON.parse(body); requests.push(payload); requestNumber += 1
      expect(request.method).toBe('POST'); expect(request.url).toBe('/v1/chat/completions')
      expect(payload.model).toBe('fixture-s13-delivery')
      response.writeHead(200, { 'Content-Type': 'text/event-stream' })
      const id = `s13-delivery-${requestNumber}`, results = toolResults(payload)
      if (requestNumber === 1) {
        const fixed = payload.messages.find((message: any) => typeof message.content === 'string' && message.content.startsWith('本次固定文档与权限'))
        const references = JSON.parse(fixed.content.slice(fixed.content.indexOf('：') + 1))
        expect(references).toHaveLength(1)
        observedTools.push('build.create')
        call(response, id, [{ id: 'delivery-create', name: wire(payload, '从有整份文档写权限'), input: { target: references[0].target } }])
      } else if (requestNumber === 2) {
        job = results.at(-1).data.job; expect(job).toBeTruthy()
        observedTools.push(...Object.keys(externalPackage.files).map(name => `build.write:${name}`), 'build.write:project')
        call(response, id, [
          ...Object.entries(externalPackage.files).map(([name, bytes], index) => ({
            id: `delivery-write-package-${index}`, name: wire(payload, '写入受管 scratch'),
            input: { job, path: `components/${packageKey}/${name}`, encoding: 'base64', content: Buffer.from(bytes).toString('base64') },
          })),
          { id: 'delivery-write-project', name: wire(payload, '写入受管 scratch'), input: { job, path: 'project.json', content: JSON.stringify(validatedCandidate) } },
        ])
      } else if (requestNumber === 3) {
        expect(results.slice(-(Object.keys(externalPackage.files).length + 1)).every((result: any) => result.data.status === 'editing')).toBe(true)
        observedTools.push('build.compile')
        call(response, id, [{ id: 'delivery-compile', name: wire(payload, '仅对指定 Component/Runtime'), input: { job, path: runtimePath, kind: 'component' } }])
      } else if (requestNumber === 4) {
        expect(results.at(-1).data).toMatchObject({ ok: true, stage: 'syntax-checked' })
        observedTools.push('build.check')
        call(response, id, [{ id: 'delivery-check', name: wire(payload, '执行正式协议、来源、资源闭包'), input: {
          job, buttonCheck: { version: 1, instanceId, label: '显示答案' },
        } }])
      } else if (requestNumber === 5) {
        expect(results.at(-1).data).toMatchObject({ status: 'ready', prepared: true, artifact: expect.any(String) })
        artifact = results.at(-1).data.artifact
        await importGate
        observedTools.push('build.import')
        call(response, id, [{ id: 'delivery-import', name: wire(payload, '导入已准入 artifact'), input: { job, artifact } }])
      } else if (requestNumber === 6) {
        expect(results.at(-1)).toMatchObject({ kind: 'document-operation', result: { status: 'applied' } })
        response.write(sse(id, { role: 'assistant', content: '受控组件已导入。' }, 'stop'))
        response.end('data: [DONE]\n\n')
      } else throw new Error(`Unexpected model request ${requestNumber}`)
    } catch (error) {
      serverErrors.push(error instanceof Error ? error.stack ?? error.message : String(error))
      if (!response.headersSent) response.writeHead(500, { 'Content-Type': 'text/plain' })
      response.end('fixture provider assertion failed')
    }
  })
  await new Promise<void>(resolveListen => server.listen(0, '127.0.0.1', resolveListen))
  const endpoint = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`
  let app: ElectronApplication | null = null
  let browser: Awaited<ReturnType<typeof chromium.launch>> | null = null
  const admissionWindows = new Set<string>()
  const packagedExe = process.env.COURSEWARE_E2E_PACKAGED_EXE?.trim()
  let packageIdentity: Record<string, unknown> | null = null
  try {
    if (packagedExe) {
      const exePath = resolve(packagedExe), asarPath = join(dirname(exePath), 'resources', 'app.asar')
      if (!existsSync(exePath) || !existsSync(asarPath)) throw new Error(`Packaged Electron app missing: ${exePath}`)
      const sourcePackage = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name: string; version: string }
      const asarPackage = readAsarPackageMetadata(asarPath)
      expect(asarPackage).toMatchObject({ name: sourcePackage.name, version: sourcePackage.version })
      const comparedFiles = [
        join('dist-electron', 'main', 'index.js'),
        join('dist-electron', 'main', 'workbench', 'build', 'ControlledBuildService.js'),
        join('dist-electron', 'main', 'workbench', 'execution', 'ExecutionEngine.js'),
        join('dist-electron', 'main', 'workbench', 'execution', 'ExecutionDesktopService.js'),
        join('dist-renderer', 'index.html'),
      ]
      for (const relative of comparedFiles) {
        expect(Buffer.from(extractFile(asarPath, relative)), `Packaged ${relative} differs from current dist; rebuild the package`).toEqual(readFileSync(join(root, relative)))
      }
      packageIdentity = { exe: await collectFileArtifactEvidence(exePath), asar: await collectFileArtifactEvidence(asarPath),
        asarPackage, comparedFiles, matchedComparedFiles: true }
    }
    app = await electron.launch({ cwd: packagedExe ? dirname(resolve(packagedExe)) : root,
      args: [...(packagedExe ? [] : ['.']), `--user-data-dir=${join(directory, 'profile')}`],
      ...(packagedExe ? { executablePath: resolve(packagedExe) } : {}),
      env: { ...process.env, VITE_DEV_SERVER_URL: '', [BACKGROUND_E2E_ENV]: '1' } })
    if (packagedExe) {
      const running = await app.evaluate(({ app }) => ({ isPackaged: app.isPackaged, version: app.getVersion(), exePath: process.execPath,
        appPath: app.getAppPath() }))
      expect(running.isPackaged).toBe(true)
      expect(resolve(running.exePath).toLowerCase()).toBe(resolve(packagedExe).toLowerCase())
      expect(running.version).toBe((packageIdentity!.asarPackage as { version: string }).version)
      packageIdentity = { ...packageIdentity, running }
    }
    app.on('window', worker => {
      const observe = () => { if (worker.url().includes('/admission.html')) admissionWindows.add(worker.url()) }
      observe(); worker.on('framenavigated', observe)
    })
    const page = await app.firstWindow(); page.setDefaultTimeout(20_000)
    const rendererErrors: string[] = []; page.on('pageerror', error => rendererErrors.push(error.message))
    await page.evaluate(async endpoint => {
      const settings = window.desktopAPI!.executionSettings!
      const connection = await settings.saveConnection({ apiKey: 'fixture-s13-delivery-only', connection: {
        provider: 'fixture-controlled-http', protocol: 'openai-chat', baseURL: endpoint, accountId: 'local-fixture',
        authKind: 'api-key', billing: { kind: 'unknown' },
      } })
      await settings.saveProfile({ expectedRevision: 0, roles: {
        conversation: { connectionId: connection.connection.id, model: 'fixture-s13-delivery' },
        vision: null, imageGenerate: null, imageEdit: null,
      } })
    }, endpoint)
    await app.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }) }, workspace)
    await page.getByLabel('切换工作空间', { exact: true }).click()
    await page.getByRole('button', { name: '选择其他工作空间文件夹…', exact: true }).click()
    const tree = page.locator('.lesson-directory-tree')
    await expect(tree.getByRole('button', { name: '受控交付课件.h5lesson', exact: true })).toBeVisible()
    const prepared = await page.evaluate(async input => {
      const documents = window.desktopAPI!.documents!, execution = window.desktopAPI!.execution!
      const course = await documents.open(input.coursePath)
      if (course.model.kind !== 'course-v9') throw new Error('Expected course model')
      const scene = course.model.project.surfaces[0]
      const space = await execution.workspace(input.workspace)
      const conversation = space.conversations[0] ?? await execution.createConversation(space.workspace.workspaceId)
      const saved = await execution.draft({ workspaceId: space.workspace.workspaceId, conversationId: conversation.conversationId,
        expectedRevision: conversation.revision, text: '将受支持外部组件包从 scratch 构建、验证并导入当前课件。',
        documents: [{ documentId: course.documentId, epoch: course.epoch, revision: course.revision,
          writable: [{ kind: 'document' }] }], attachments: [] })
      return { documentId: course.documentId, revision: course.revision, undoDepth: course.undoDepth,
        packagePresent: Boolean(course.model.project.componentPackages[input.packageId]),
        resourcePresent: Boolean(course.model.resources.components[input.packageKey]),
        instancePresent: scene?.type === 'slide' && scene.scenes.some(item => item.layerItems.some(layer => layer.layerItemId === input.instanceId)),
        conversationId: saved.conversationId }
    }, { workspace, coursePath, packageId, packageKey, instanceId })
    expect(prepared).toMatchObject({ undoDepth: 0, packagePresent: false, resourcePresent: false, instancePresent: false })
    await page.reload()
    await tree.getByRole('button', { name: '受控交付课件.h5lesson', exact: true }).dblclick()
    await expect(page.getByLabel('给创作助手发消息')).toHaveValue(/受支持外部组件包/)
    await page.getByRole('button', { name: '发送', exact: true }).click()
    await expect(page.getByRole('dialog', { name: '发送前的服务与范围说明' })).toHaveCount(0)
    await expect.poll(() => {
      if (serverErrors.length) throw new Error(serverErrors.join('\n'))
      return requests.length
    }, { timeout: 120_000 }).toBe(5)
    beforeImport = await page.evaluate(async input => {
      const snapshot = await window.desktopAPI!.documents!.read(input.documentId)
      if (snapshot.model.kind !== 'course-v9') throw new Error('Expected course model before import')
      const surface = snapshot.model.project.surfaces[0]
      return { revision: snapshot.revision, undoDepth: snapshot.undoDepth,
        packagePresent: Boolean(snapshot.model.project.componentPackages[input.packageId]),
        resourcePresent: Boolean(snapshot.model.resources.components[input.packageKey]),
        instancePresent: surface?.type === 'slide' && surface.scenes.some(scene => scene.layerItems.some(item => item.layerItemId === input.instanceId)) }
    }, { ...prepared, packageId, packageKey, instanceId })
    expect(beforeImport).toMatchObject({ revision: prepared.revision, undoDepth: prepared.undoDepth,
      packagePresent: false, resourcePresent: false, instancePresent: false })
    releaseImport()
    await expect.poll(() => {
      if (serverErrors.length) throw new Error(serverErrors.join('\n'))
      return requests.length
    }, { timeout: 120_000 }).toBe(6)
    await expect(page.getByText('受控组件已导入。', { exact: true })).toBeVisible()
    expect(serverErrors).toEqual([])
    expect(admissionWindows.size).toBeGreaterThan(0)
    expect(observedTools).toEqual(['build.create', ...Object.keys(externalPackage.files).map(name => `build.write:${name}`),
      'build.write:project', 'build.compile', 'build.check', 'build.import'])

    const history = await page.evaluate(async input => {
      const documents = window.desktopAPI!.documents!
      const read = async () => {
        const snapshot = await documents.read(input.documentId)
        if (snapshot.model.kind !== 'course-v9') throw new Error('Expected course model')
        const files = snapshot.model.resources.components[input.packageKey]
        const meta = snapshot.model.project.componentPackages[input.packageId]
        const surface = snapshot.model.project.surfaces[0]
        return { snapshot, packagePresent: Boolean(meta), resourcePresent: Boolean(files),
          instancePresent: surface?.type === 'slide' && surface.scenes.some(scene => scene.layerItems.some(item => item.layerItemId === input.instanceId)),
          source: files?.['runtime.js'] ? new TextDecoder().decode(files['runtime.js']) : null,
          hash: meta?.contentSha256 ?? null, packageSha256: meta?.sha256 ?? null }
      }
      const imported = await read()
      const undo = await documents.dispatch({ documentId: input.documentId, epoch: imported.snapshot.epoch,
        baseRevision: imported.snapshot.revision, operationId: 's13-delivery-undo', actor: 'human', mutation: { type: 'undo' } })
      const undone = await read()
      const redo = await documents.dispatch({ documentId: input.documentId, epoch: undone.snapshot.epoch,
        baseRevision: undone.snapshot.revision, operationId: 's13-delivery-redo', actor: 'human', mutation: { type: 'redo' } })
      const redone = await read()
      await documents.save(input.documentId)
      return {
        imported: { revision: imported.snapshot.revision, undoDepth: imported.snapshot.undoDepth, packagePresent: imported.packagePresent,
          resourcePresent: imported.resourcePresent, instancePresent: imported.instancePresent,
          source: imported.source, hash: imported.hash, packageSha256: imported.packageSha256 },
        undo, undone: { undoDepth: undone.snapshot.undoDepth, redoDepth: undone.snapshot.redoDepth,
          packagePresent: undone.packagePresent, resourcePresent: undone.resourcePresent, instancePresent: undone.instancePresent,
          hash: undone.hash, source: undone.source, packageSha256: undone.packageSha256 },
        redo, redone: { undoDepth: redone.snapshot.undoDepth, redoDepth: redone.snapshot.redoDepth,
          packagePresent: redone.packagePresent, resourcePresent: redone.resourcePresent, instancePresent: redone.instancePresent,
          hash: redone.hash, source: redone.source, packageSha256: redone.packageSha256 },
      }
    }, { ...prepared, packageId, packageKey, instanceId })
    expect(history.imported).toMatchObject({ undoDepth: 1, packagePresent: true, resourcePresent: true, instancePresent: true,
      hash: candidateHash, packageSha256: externalPackageSha256, source: componentSource })
    expect(history.undo).toMatchObject({ status: 'applied' })
    expect(history.undone).toMatchObject({ undoDepth: 0, redoDepth: 1, packagePresent: false, resourcePresent: false,
      instancePresent: false, hash: null, source: null, packageSha256: null })
    expect(history.redo).toMatchObject({ status: 'applied' })
    expect(history.redone).toMatchObject({ undoDepth: 1, redoDepth: 0, packagePresent: true, resourcePresent: true,
      instancePresent: true, hash: candidateHash, packageSha256: externalPackageSha256, source: componentSource })
    const reopenedArchive = openCourseProjectArchive(new Uint8Array(readFileSync(coursePath)))
    expect(new TextDecoder().decode(reopenedArchive.componentFiles[packageKey]!['runtime.js'])).toBe(componentSource)
    expect(reopenedArchive.project.componentPackages[packageId]).toMatchObject({ contentSha256: candidateHash, sha256: externalPackageSha256 })
    expect(reopenedArchive.project.surfaces[0]?.type).toBe('slide')
    if (reopenedArchive.project.surfaces[0]?.type === 'slide') {
      expect(reopenedArchive.project.surfaces[0].scenes[0]!.layerItems.some(item => item.layerItemId === instanceId && item.kind === 'component')).toBe(true)
      expect(reopenedArchive.project.surfaces[0].scenes[0]!.layerItems.some(item => item.layerItemId === 's13-delivery-runtime' && item.kind === 'runtime')).toBe(true)
    }
    expect(Buffer.from(reopenedArchive.assetFiles['quiz-fallback']!)).toEqual(Buffer.from(fallback))

    await page.locator('.workspace-document-tabs').getByRole('button', { name: '关闭 受控交付课件.h5lesson', exact: true }).click()
    await expect(page.locator('.workspace-document-tabs').getByRole('tab', { name: '受控交付课件.h5lesson', exact: true })).toHaveCount(0)
    await tree.getByRole('button', { name: '受控交付课件.h5lesson', exact: true }).dblclick()
    const reopened = await page.evaluate(async input => {
      const snapshot = await window.desktopAPI!.documents!.open(input.coursePath)
      if (snapshot.model.kind !== 'course-v9') throw new Error('Reopened course missing')
      return { documentId: snapshot.documentId, dirty: snapshot.dirty,
        hash: snapshot.model.project.componentPackages[input.packageId]!.contentSha256,
        packageSha256: snapshot.model.project.componentPackages[input.packageId]!.sha256,
        source: new TextDecoder().decode(snapshot.model.resources.components[input.packageKey]!['runtime.js']) }
    }, { coursePath, packageId, packageKey })
    expect(reopened).toMatchObject({ dirty: false, hash: candidateHash, packageSha256: externalPackageSha256, source: componentSource })
    await page.getByRole('button', { name: '深度编辑', exact: true }).click()
    await expect(page.getByTestId('canvas-stage')).toBeVisible()
    await app.evaluate(({ dialog }, filename) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: filename }) }, htmlPath)
    await page.getByTestId('export-menu-trigger').click()
    await page.getByTestId('export-single-html').click()
    const preflight = page.getByRole('alertdialog', { name: '单 HTML 导出预检' })
    await expect(preflight).toContainText('0 个错误')
    await preflight.getByRole('button', { name: '继续导出' }).click()
    const sizeDialog = page.getByRole('alertdialog', { name: '单 HTML 文件较大' })
    if (await sizeDialog.isVisible().catch(() => false)) await sizeDialog.getByRole('button', { name: '仍导出单 HTML' }).click()
    await expect.poll(() => existsSync(htmlPath) ? statSync(htmlPath).size : 0, { timeout: 120_000 }).toBeGreaterThan(100_000)
    const html = readFileSync(htmlPath, 'utf8')
    // The offline exporter may use a fresh static capture in place of the authored fallback.
    // The archive assertion above proves the original is saved; here prove embedded image closure.
    expect(html.includes('data:image/png;base64,')).toBe(true)
    expect(html.includes('s13-delivery-runtime')).toBe(true)

    browser = await chromium.launch({ headless: true })
    const context = await browser.newContext({ offline: true, viewport: { width: 1440, height: 900 } })
    const offline = await context.newPage()
    const pageErrors: string[] = [], externalRequests: string[] = []
    offline.on('pageerror', error => pageErrors.push(error.message))
    offline.on('request', request => { if (/^https?:/.test(request.url())) externalRequests.push(request.url()) })
    await offline.goto(pathToFileURL(htmlPath).href)
    const runtimeButton = offline.locator('[data-s13-delivery-runtime="true"]')
    await expect(runtimeButton).toHaveText('Runtime 次数：0', { timeout: 20_000 })
    await runtimeButton.click()
    await expect(runtimeButton).toHaveText('Runtime 次数：1')
    await expect(offline.getByText('答案尚未显示', { exact: true })).toBeVisible()
    await offline.getByRole('button', { name: '显示答案', exact: true }).click()
    await expect(offline.getByText('正确答案：受控导入并离线播放。', { exact: true })).toBeVisible()
    await offline.screenshot({ path: join(directory, 'offline-component-runtime-clicked.png'), fullPage: true })
    expect(externalRequests).toEqual([])
    expect(pageErrors).toEqual([])
    expect(rendererErrors).toEqual([])
    const evidence = join(directory, 'evidence.json')
    writeFileSync(evidence, JSON.stringify({ provider: 'fixture-controlled-http', model: 'fixture-s13-delivery',
      requests: requests.length, observedTools, admissionWindows: [...admissionWindows],
      externalPackage: { path: externalPackagePath, sha256: externalPackageSha256, contentSha256: candidateHash,
        files: Object.keys(externalPackage.files), provenance: externalPackage.metadata.sourceLabel },
      packageIdentity, preImport: prepared, beforeImport,
      history, reopened, archiveAssetBytes: reopenedArchive.assetFiles['quiz-fallback']!.byteLength,
      offlineHtmlBytes: statSync(htmlPath).size, externalRequests, pageErrors, rendererErrors, serverErrors }, null, 2))
    await info.attach('s13-controlled-delivery-evidence', { path: evidence, contentType: 'application/json' })
    await info.attach('s13-offline-interaction', { path: join(directory, 'offline-component-runtime-clicked.png'), contentType: 'image/png' })
  } catch (error) {
    const page = app?.windows()[0]
    if (page) await page.screenshot({ path: join(directory, 'failure.png'), fullPage: true }).catch(() => undefined)
    writeFileSync(join(directory, 'failure.json'), JSON.stringify({ requests: requests.length, observedTools, admissionWindows: [...admissionWindows], serverErrors }, null, 2))
    throw error
  } finally {
    releaseImport()
    await browser?.close().catch(() => undefined)
    if (app) {
      await app.evaluate(({ app, BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(window => window.destroy()); app.exit(0) }).catch(() => undefined)
      await app.close().catch(() => undefined)
    }
    server.closeAllConnections(); await new Promise<void>(resolveClose => server.close(() => resolveClose()))
  }
})
