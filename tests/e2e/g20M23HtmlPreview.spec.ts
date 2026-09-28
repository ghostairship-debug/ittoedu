import { expect, test } from '@playwright/test'
import { join } from 'node:path'
import { m23Fixture } from './helpers/g20M23Fixtures'
import { chooseM23Workspace, closeM23, launchM23, m23PreviewFrame, m23Shot, openM23Html, writeM23Evidence } from './helpers/g20M23Harness'

type SecurityProbe = {
  own: { desktopAPI: boolean; require: boolean; process: boolean }
  parentApiReadable: boolean
  parentApiValue: string
  parentFrameCount: number
  otherFrames: number
  crossFrameReads: number
}

test('M23-T01 sandboxed HTML previews cannot reach editor APIs, sibling frames, outside files or navigation', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'M23 security acceptance requires the Windows Electron host.')
  test.setTimeout(300_000)
  const fixture = m23Fixture('security')
  const facts: Record<string, unknown> = { case: 'M23-T01', status: 'running', requiredChecks: [] }
  let app: Awaited<ReturnType<typeof launchM23>>['app'] | undefined
  let page: Awaited<ReturnType<typeof launchM23>>['page'] | undefined
  let capture: Awaited<ReturnType<typeof launchM23>>['capture'] | undefined
  let failure: unknown
  try {
    const launched = await launchM23(fixture); app = launched.app; page = launched.page; capture = launched.capture
    await chooseM23Workspace(app, page, fixture.workspace)
    const first = await openM23Html(page, 'security-one.html')
    const second = await openM23Html(page, 'security-two.html')
    await expect(page.locator('iframe[title="HTML 预览"]')).toHaveCount(2)
    const firstPreview = first.frameLocator('iframe[title="HTML 预览"]')
    const secondPreview = second.frameLocator('iframe[title="HTML 预览"]')
    const readProbe = async (preview: typeof firstPreview): Promise<SecurityProbe> => preview.locator('body').evaluate(body => {
      const probe = (window as Window & { __m23SecurityProbe?: () => SecurityProbe }).__m23SecurityProbe
      if (!probe) throw new Error('Security fixture did not initialize')
      return probe()
    })
    await page.locator('.workspace-document-tabs').getByRole('tab', { name: /^security-one\.html/ }).click()
    await expect(first).toBeVisible()
    const firstProbe = await readProbe(firstPreview)
    await page.locator('.workspace-document-tabs').getByRole('tab', { name: /^security-two\.html/ }).click()
    await expect(second).toBeVisible()
    const secondProbe = await readProbe(secondPreview)
    const probes = { first: firstProbe, second: secondProbe }
    facts.securityProbes = probes
    expect(probes.first.own).toEqual({ desktopAPI: false, require: false, process: false })
    expect(probes.second.own).toEqual({ desktopAPI: false, require: false, process: false })
    expect(probes.first.parentApiReadable).toBe(false)
    expect(probes.second.parentApiReadable).toBe(false)
    expect(probes.first.otherFrames).toBeGreaterThanOrEqual(1)
    expect(probes.second.otherFrames).toBeGreaterThanOrEqual(1)
    expect(probes.first.crossFrameReads).toBe(0)
    expect(probes.second.crossFrameReads).toBe(0)

    await page.locator('.workspace-document-tabs').getByRole('tab', { name: /^security-one\.html/ }).click()
    await expect(first).toBeVisible()
    const appUrl = page.url()
    const beforeWindows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
    await firstPreview.getByRole('button', { name: '尝试顶层导航', exact: true }).click()
    await firstPreview.getByRole('button', { name: '提交表单', exact: true }).click()
    await firstPreview.getByRole('button', { name: '尝试新窗口', exact: true }).click()
    await expect.poll(() => page!.url()).toBe(appUrl)
    const afterWindows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
    facts.navigation = { appUrl, afterUrl: page.url(), beforeWindows, afterWindows, popups: capture.popups }
    expect(afterWindows).toBe(beforeWindows)
    expect(capture.popups).toEqual([])
    expect(capture.requests.some(request => request.includes('g20-fixture.invalid'))).toBe(false)

    const fetchAttacks = await firstPreview.locator('body').evaluate(async () => {
      const actions = (window as Window & { __m23Actions?: Record<string, () => Promise<unknown>> }).__m23Actions
      if (!actions) throw new Error('Security fixture actions are unavailable')
      return { relative: await actions.relative(), encoded: await actions.encoded(), ...(await actions.symlink().then(value => ({ symlink: value }))) }
    }) as { relative: { status?: number; body?: string; error?: string }; encoded: { status?: number; body?: string; error?: string }; symlink?: { status?: number; body?: string; error?: string } }
    facts.fetchAttacks = fetchAttacks
    for (const result of [fetchAttacks.relative, fetchAttacks.encoded]) {
      expect(result.status).toBe(404)
      expect(result.body).toBe('Not found')
      expect(result.body).not.toContain('M23 OUTSIDE WORKSPACE SECRET')
    }
    if (fixture.symlinkError) facts.symlinkEscape = { status: 'untested', reason: fixture.symlinkError }
    else {
      expect(fetchAttacks.symlink?.status).toBe(404)
      expect(fetchAttacks.symlink?.body).toBe('Not found')
      expect(fetchAttacks.symlink?.body).not.toContain('M23 OUTSIDE WORKSPACE SECRET')
      facts.symlinkEscape = { status: 'passed', link: fixture.files.symlink, outsideSecret: fixture.files.outsideSecret }
    }

    const firstUrl = await first.locator('iframe[title="HTML 预览"]').getAttribute('src')
    await page.locator('.workspace-document-tabs').getByRole('tab', { name: /^security-two\.html/ }).click()
    await expect(second).toBeVisible()
    const secondUrl = await second.locator('iframe[title="HTML 预览"]').getAttribute('src')
    expect(firstUrl).toMatch(/^courseware-preview:\/\/app\//)
    expect(secondUrl).toMatch(/^courseware-preview:\/\/app\//)
    await page.getByRole('button', { name: '关闭 security-one.html', exact: true }).click()
    await expect(first).toHaveCount(0)
    const leaseChecks = await secondPreview.locator('body').evaluate(async (_body, urls) => {
      const load = async (url: string) => {
        const response = await fetch(url)
        return { status: response.status, body: await response.text() }
      }
      return { released: await load(urls.first), remaining: await load(urls.second) }
    }, { first: firstUrl!, second: secondUrl! })
    facts.leaseChecks = leaseChecks
    expect(leaseChecks.released).toMatchObject({ status: 404, body: 'Not found' })
    expect(leaseChecks.remaining.status).toBe(200)
    expect(leaseChecks.remaining.body).toContain('隔离检查页乙')
    await expect(secondPreview.getByRole('heading', { name: '隔离检查页乙', exact: true })).toBeVisible()
    facts.status = fixture.symlinkError ? 'partial' : 'passed'
    facts.untested = fixture.symlinkError ? ['symlink escape: OS refused fixture symlink creation'] : []
    await m23Shot(fixture, page, info, 'security-after-lease-revocation')
    expect(capture.pageErrors).toEqual([])
  } catch (error) {
    failure = error; facts.status = 'failed'; throw error
  } finally {
    if (app && page && capture) {
      await m23Shot(fixture, page, info, failure ? 'failure' : 'security-result')
      const evidence = await writeM23Evidence(fixture, page, app, capture, facts, failure)
      await info.attach('M23-T01 evidence.json', { path: evidence, contentType: 'application/json' })
      await closeM23(app)
    }
  }
})

test('M23-T02 HTML preview paginates fixed, flow and camera layouts and keeps placeholders and page state', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'M23 preview acceptance requires the Windows Electron host.')
  test.setTimeout(300_000)
  const fixture = m23Fixture('preview')
  const facts: Record<string, unknown> = { case: 'M23-T02', status: 'running', steps: [] }
  let app: Awaited<ReturnType<typeof launchM23>>['app'] | undefined
  let page: Awaited<ReturnType<typeof launchM23>>['page'] | undefined
  let capture: Awaited<ReturnType<typeof launchM23>>['capture'] | undefined
  let failure: unknown
  try {
    const launched = await launchM23(fixture); app = launched.app; page = launched.page; capture = launched.capture
    await chooseM23Workspace(app, page, fixture.workspace)
    const region = await openM23Html(page, 'three-sections.html')
    const preview = region.frameLocator('iframe[title="HTML 预览"]')
    const toolbar = region.getByRole('toolbar', { name: 'HTML 分页', exact: true })
    await expect(toolbar).toContainText('1 / 3')
    await expect(preview.locator('#fixed-page')).toBeVisible()
    await expect(preview.locator('#flow-page')).toBeHidden()
    await expect(preview.locator('#camera-page')).toBeHidden()
    const pageShape = await preview.locator('body').evaluate(() => ({
      directSections: document.querySelectorAll('body > main > section').length,
      allSections: document.querySelectorAll('section').length,
      fixedWidth: getComputedStyle(document.querySelector('#fixed-page')!).width,
      fixedHeight: getComputedStyle(document.querySelector('#fixed-page')!).height,
      flowMaxWidth: getComputedStyle(document.querySelector('#flow-page')!).maxWidth,
      pageTitle: document.title,
    }))
    facts.pageShape = pageShape
    expect(pageShape).toMatchObject({ directSections: 3, allSections: 4, fixedWidth: '1280px', fixedHeight: '720px', flowMaxWidth: '780px' })
    const renderDiagnostics = await Promise.all([
      region.locator('iframe[title="HTML 预览"]').evaluate(frame => {
        const style = getComputedStyle(frame), rect = frame.getBoundingClientRect()
        return { surface: 'workbench iframe', display: style.display, visibility: style.visibility, opacity: style.opacity,
          rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, src: (frame as HTMLIFrameElement).src }
      }),
      preview.locator('body').evaluate(body => {
        const style = getComputedStyle(body), rect = body.getBoundingClientRect()
        const active = document.querySelector('#fixed-page')!, activeStyle = getComputedStyle(active), activeRect = active.getBoundingClientRect()
        const center = document.elementFromPoint(innerWidth / 2, innerHeight / 2)
        return { surface: 'sandbox frame document', bodyDisplay: style.display, bodyVisibility: style.visibility,
          bodyOpacity: style.opacity, bodyRect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          activeDisplay: activeStyle.display, activeVisibility: activeStyle.visibility, activeOpacity: activeStyle.opacity,
          activeRect: { x: activeRect.x, y: activeRect.y, width: activeRect.width, height: activeRect.height },
          center: center ? { tag: center.tagName, id: (center as HTMLElement).id, text: center.textContent?.slice(0, 100) } : null,
          visibleText: (body as HTMLElement).innerText.slice(0, 500) }
      }),
    ])
    facts.renderDiagnostics = renderDiagnostics
    const placeholders = preview.locator('[data-html-preview-placeholder]')
    await expect(placeholders).toHaveCount(3)
    await expect(preview.locator('[data-html-preview-placeholder="img"]')).toHaveText('图片：未提供图片源')
    await expect(preview.locator('[data-html-preview-placeholder="audio"]')).toHaveText('音频：未提供音频源')
    await expect(preview.locator('[data-html-preview-placeholder="video"]')).toHaveText('视频：未提供视频源')
    await expect(preview.locator('#missing-image')).not.toHaveAttribute('src', /.+/)
    await expect(preview.locator('#missing-audio')).not.toHaveAttribute('src', /.+/)
    await expect(preview.locator('#missing-video')).not.toHaveAttribute('src', /.+/)
    await m23Shot(fixture, page, info, 'fixed-page', app)
    facts.visualEvidence = {
      browserWindow: join(fixture.directory, 'shots', 'fixed-page-native-window.png'),
      iframeElement: join(fixture.directory, 'shots', 'fixed-page-iframe.png'),
      playwrightPageCapture: join(fixture.directory, 'shots', 'fixed-page.png'),
      playwrightPageCaptureNote: 'OOPIF omitted by Playwright full-page capture in this hidden BrowserWindow; use native BrowserWindow or iframe element image for visual review.',
      diagnostics: join(fixture.directory, 'shots', 'fixed-page-capture-diagnostics.json'),
    }

    await preview.locator('#fixed-page .counter-widget button').click()
    await expect(preview.locator('#fixed-page output')).toHaveText('计数：1')
    await toolbar.getByRole('button', { name: '下一页', exact: true }).click()
    await expect(toolbar).toContainText('2 / 3')
    await expect(preview.locator('#flow-page')).toBeVisible()
    await expect(preview.locator('#fixed-page')).toBeHidden()
    await preview.locator('#flow-page .counter-widget button').click()
    await expect(preview.locator('#flow-page output')).toHaveText('计数：1')
    await m23Shot(fixture, page, info, 'flow-page')

    await toolbar.getByRole('button', { name: '下一页', exact: true }).click()
    await expect(toolbar).toContainText('3 / 3')
    await expect(preview.locator('#camera-page')).toBeVisible()
    const camera = preview.locator('[data-camera-track]')
    await expect.poll(() => camera.getAttribute('data-camera-frame').then(value => Number(value))).toBeGreaterThan(0)
    await preview.locator('#camera-page .counter-widget button').click()
    await expect(preview.locator('#camera-page output')).toHaveText('计数：1')
    const frameBeforeHide = Number(await camera.getAttribute('data-camera-frame'))
    await toolbar.getByRole('button', { name: '上一页', exact: true }).click()
    await expect(toolbar).toContainText('2 / 3')
    await expect.poll(() => camera.getAttribute('data-camera-frame').then(value => Number(value))).toBeGreaterThan(frameBeforeHide)
    await toolbar.getByRole('button', { name: '下一页', exact: true }).click()
    await expect(toolbar).toContainText('3 / 3')
    await expect(preview.locator('#camera-page output')).toHaveText('计数：1')
    await m23Shot(fixture, page, info, 'camera-page')

    await toolbar.getByRole('button', { name: '上一页', exact: true }).click()
    await expect(toolbar).toContainText('2 / 3')
    await region.getByRole('toolbar', { name: 'HTML 视图', exact: true }).getByRole('button', { name: '源码', exact: true }).click()
    await expect(region.getByLabel('纯文本编辑', { exact: true })).toBeVisible()
    await region.getByRole('toolbar', { name: 'HTML 视图', exact: true }).getByRole('button', { name: '预览', exact: true }).click()
    await expect(toolbar).toContainText('2 / 3')
    await expect(preview.locator('#flow-page')).toBeVisible()
    await expect(preview.locator('#fixed-page output')).toHaveText('计数：1')
    await expect(preview.locator('#flow-page output')).toHaveText('计数：1')
    await expect(preview.locator('#camera-page output')).toHaveText('计数：1')
    facts.status = 'passed'
    facts.interactions = { fixedCounter: 1, flowCounter: 1, cameraCounter: 1, cameraFrameBeforeHide: frameBeforeHide,
      cameraFrameAfterHide: Number(await camera.getAttribute('data-camera-frame')), pageAfterSourceReturn: '2 / 3', placeholders: 3 }
    await m23Shot(fixture, page, info, 'source-return-flow-page')
    expect(capture.pageErrors).toEqual([])
  } catch (error) {
    failure = error; facts.status = 'failed'; throw error
  } finally {
    if (app && page && capture) {
      await m23Shot(fixture, page, info, failure ? 'failure' : 'preview-result')
      const evidence = await writeM23Evidence(fixture, page, app, capture, facts, failure)
      await info.attach('M23-T02 evidence.json', { path: evidence, contentType: 'application/json' })
      await closeM23(app)
    }
  }
})
