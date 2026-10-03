import { expect, test } from '@playwright/test'
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

// M25-T03｜HTML完整视口和离线播放器兼容
// 操作: 小/大窗口、错误栏、隐藏恢复标签；第二页反复点击答案；隔离反例
// 验收: 预览占满剩余空间，滚动正确；正文/控制器/脚本真实执行，无Node/凭据/越权文件，不静态冒充
test('M25-T03 full-viewport HTML preview resizes with window, scrolls correctly, executes scripts and stays isolated from Node/credentials', async ({}, info) => {
  test.skip(process.platform !== 'win32', 'M25-T03 requires the Windows Electron host.')
  test.setTimeout(300_000)
  const fixture = m23Fixture('preview')
  const facts: Record<string, unknown> = { case: 'M25-T03', status: 'running', steps: [] as string[] }
  const steps = facts.steps as string[]
  let app: Awaited<ReturnType<typeof launchM23>>['app'] | undefined
  let page: Awaited<ReturnType<typeof launchM23>>['page'] | undefined
  let capture: Awaited<ReturnType<typeof launchM23>>['capture'] | undefined
  let failure: unknown
  try {
    const launched = await launchM23(fixture); app = launched.app; page = launched.page; capture = launched.capture
    await chooseM23Workspace(app, page, fixture.workspace)
    const region = await openM23Html(page, 'three-sections.html')
    const previewFrame = m23PreviewFrame(page)
    const preview = region.frameLocator('iframe[title="HTML 预览"]')
    const toolbar = region.getByRole('toolbar', { name: 'HTML 分页', exact: true })
    await expect(toolbar).toContainText('1 / 3')
    steps.push('opened')

    // ---------- 小/大窗口: 预览占满剩余空间, 滚动正确 ----------
    const layoutSizes: Array<{ width: number; height: number; fixedInViewport: boolean; noticeVisible: boolean; iframeRectHeight: number; paneHeight: number }> = []
    for (const [width, height] of [[1000, 640], [1920, 1080]]) {
      const applied = await app.evaluate(({ BrowserWindow }, size) => {
        const win = BrowserWindow.getAllWindows()[0]!
        win.setContentSize(size[0], size[1])
        return win.getContentSize()
      }, [width, height])
      // 等 renderer 真实看到新 innerWidth/innerHeight, 再做几何断言
      await expect.poll(() => page!.evaluate(() => [innerWidth, innerHeight]), { timeout: 15_000 }).toEqual(applied)
      await expect.poll(async () => await preview.locator('body').evaluate(() => innerHeight), { timeout: 15_000 }).toBeGreaterThan(0)
      // preview 占满剩余空间: iframe 高度 ≈ pane 高度 - toolbar 高度
      await expect.poll(async () => {
        return await region.locator('iframe[title="HTML 预览"]').evaluate(frame => {
          const pane = frame.parentElement as HTMLElement
          const tools = pane.querySelector<HTMLElement>('[aria-label="HTML 分页"]')
          const notice = pane.querySelector<HTMLElement>('.html-preview-pane__notice')
          const available = pane.getBoundingClientRect().height - (tools?.getBoundingClientRect().height ?? 0)
            - (notice?.getBoundingClientRect().height ?? 0)
          return Math.abs(frame.getBoundingClientRect().height - available)
        })
      }).toBeLessThan(4)
      const metrics = await preview.locator('body').evaluate(() => {
        const fixed = document.querySelector<HTMLElement>('#fixed-page')!
        const rect = fixed.getBoundingClientRect()
        return {
          fixedWidth: rect.width, fixedHeight: rect.height, vw: innerWidth, vh: innerHeight,
          fixedInViewport: rect.width <= innerWidth + 2 && rect.height <= innerHeight + 2,
          scrollHeight: document.documentElement.scrollHeight,
        }
      })
      expect(metrics.fixedInViewport).toBe(true)
      // pane / toolbar geometry from the parent (renderer) side
      const paneInfo = await previewFrame.evaluate(frame => {
        const pane = frame.parentElement as HTMLElement
        const tools = pane.querySelector<HTMLElement>('[aria-label="HTML 分页"]')
        return { paneHeight: pane.getBoundingClientRect().height, toolsHeight: tools?.getBoundingClientRect().height ?? 0,
          iframeHeight: frame.getBoundingClientRect().height }
      })
      expect(paneInfo.iframeHeight).toBeGreaterThan(0)
      expect(paneInfo.iframeHeight).toBeLessThanOrEqual(paneInfo.paneHeight - paneInfo.toolsHeight + 4)
      layoutSizes.push({ width, height, fixedInViewport: metrics.fixedInViewport,
        noticeVisible: paneInfo.iframeHeight >= 0, iframeRectHeight: paneInfo.iframeHeight, paneHeight: paneInfo.paneHeight })
      // Windows DPI 可能微调 setContentSize 的实际像素量; 只要求实际值接近请求且成功变更
      expect(Math.abs(applied[0] - width)).toBeLessThanOrEqual(40)
      expect(Math.abs(applied[1] - height)).toBeLessThanOrEqual(40)
    }
    facts.layoutSizes = layoutSizes
    // 大窗口应看到更多内容 (iframe 高度显著提升)
    expect(layoutSizes[1].iframeRectHeight - layoutSizes[0].iframeRectHeight).toBeGreaterThan(200)
    steps.push('viewport-resize-ok')

    // ---------- 第二页反复点击答案 (flow-page counter 3 次递增) ----------
    await toolbar.getByRole('button', { name: '下一页', exact: true }).click()
    await expect(toolbar).toContainText('2 / 3')
    await expect(preview.locator('#flow-page')).toBeVisible()
    await expect(preview.locator('#fixed-page')).toBeHidden()
    const flowCounterButton = preview.locator('#flow-page .counter-widget button')
    for (let expected = 1; expected <= 3; expected += 1) {
      await flowCounterButton.click()
      await expect(preview.locator('#flow-page output')).toHaveText(`计数：${expected}`)
    }
    facts.flowPageClicks = 3
    steps.push('flow-page-repeated-clicks-ok')

    // 流式页面在小窗内滚动到底部后,末尾 marker 应确实入视口
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(960, 640))
    await preview.locator('#flow-end-marker').scrollIntoViewIfNeeded()
    const flowEndVisible = await preview.locator('#flow-end-marker').evaluate(el => {
      const rect = el.getBoundingClientRect()
      return rect.top < innerHeight && rect.bottom > 0
    })
    expect(flowEndVisible).toBe(true)
    facts.flowEndScrolls = true
    steps.push('flow-scroll-ok')
    // 回到大窗口,避免影响后续截图与点击 (1614 等 DPI 微调由 setContentSize 保证真实生效)
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1600, 1000))
    await expect.poll(() => page!.evaluate(() => innerWidth), { timeout: 15_000 }).toBeGreaterThan(1500)

    // ---------- 隐藏 / 恢复标签: 页面状态(页码、计数)保留 ----------
    // 未保存的现场状态由控制器 visibility 控制; 切到第三页再切回第二页
    await toolbar.getByRole('button', { name: '下一页', exact: true }).click()
    await expect(toolbar).toContainText('3 / 3')
    await preview.locator('#camera-page .counter-widget button').click()
    await expect(preview.locator('#camera-page output')).toHaveText('计数：1')
    await toolbar.getByRole('button', { name: '上一页', exact: true }).click()
    await expect(toolbar).toContainText('2 / 3')
    await expect(preview.locator('#flow-page output')).toHaveText('计数：3')
    // 隐藏/恢复切走再回: 打开另一文档, 再切回 three-sections
    await openM23Html(page, 'sibling.html')
    await expect(region).toBeHidden()
    await page.locator('.workspace-document-tabs').getByRole('tab', { name: /^three-sections\.html/ }).click()
    await expect(region).toBeVisible()
    await expect(toolbar).toContainText('2 / 3')
    await expect(preview.locator('#flow-page output')).toHaveText('计数：3')
    await expect(preview.locator('#camera-page output')).toHaveText('计数：1')
    facts.hiddenRestore = { pageAfterHidden: '2 / 3', flowCounterKept: true, cameraCounterKept: true }
    steps.push('hidden-restore-tab-ok')

    // ---------- 错误栏 / preview notice 不出现, 同时重新加载按钮存在 ----------
    await expect(region.locator('.html-preview-pane__notice')).toHaveCount(0)
    await expect(region.getByRole('alert')).toHaveCount(0)
    // 触发受控的"重新加载预览" → 走 refreshPreservingView 路径, 无 stale notice
    await region.locator('.html-preview-pane__more summary').click()
    await region.getByRole('button', { name: '重新加载预览', exact: true }).click()
    // 刷新后回到 restore 的页码
    await expect(toolbar).toContainText('2 / 3', { timeout: 30_000 })
    await expect(preview.locator('#flow-page')).toBeVisible()
    // 页面状态 reset (controller 文档明示), 但源码/草稿保留, 不应有错误栏
    await expect(region.locator('.html-preview-pane__notice')).toHaveCount(0)
    facts.errorNoticeFree = true
    steps.push('reload-preview-ok')

    // ---------- 隔离反例: 无 Node, 无 desktopAPI, 无跨 frame 读取; 越权文件读取 404 ----------
    // 使用同 fixture 内的 security-one/security-two
    const secA = await openM23Html(page, 'security-one.html')
    const secB = await openM23Html(page, 'security-two.html')
    await expect(page.locator('iframe[title="HTML 预览"]').count()).resolves.toBeGreaterThanOrEqual(2)
    // 切到 security-one
    await page.locator('.workspace-document-tabs').getByRole('tab', { name: /^security-one\.html/ }).click()
    await expect(secA).toBeVisible()
    const secAPreview = secA.frameLocator('iframe[title="HTML 预览"]')
    const securityProbe = await secAPreview.locator('body').evaluate(() => (window as Window & { __m23SecurityProbe?: () => SecurityProbe }).__m23SecurityProbe!())
    facts.isolation = securityProbe
    expect(securityProbe.own).toEqual({ desktopAPI: false, require: false, process: false })
    expect(securityProbe.parentApiReadable).toBe(false)
    expect(securityProbe.otherFrames).toBeGreaterThanOrEqual(1)
    expect(securityProbe.crossFrameReads).toBe(0)
    // 越权文件: workspace 外的 secret.txt 应被 protocol 拒绝
    const outcome = await secAPreview.locator('body').evaluate(async () => {
      const actions = (window as Window & { __m23Actions?: Record<string, () => Promise<unknown>> }).__m23Actions!
      return { relative: await actions.relative(), encoded: await actions.encoded() }
    }) as { relative: { status?: number; body?: string; error?: string }; encoded: { status?: number; body?: string; error?: string } }
    facts.pathEscape = outcome
    for (const result of [outcome.relative, outcome.encoded]) {
      expect(result.status).toBe(404)
      expect(result.body).toBe('Not found')
      expect(result.body ?? '').not.toContain('M23 OUTSIDE WORKSPACE SECRET')
    }
    // 顶层导航 / 弹窗应被 sandbox 阻断
    const beforeUrl = page.url()
    const beforeWindows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
    await secAPreview.getByRole('button', { name: '尝试顶层导航', exact: true }).click()
    await secAPreview.getByRole('button', { name: '尝试新窗口', exact: true }).click()
    await expect.poll(() => page!.url()).toBe(beforeUrl)
    const afterWindows = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().length)
    expect(afterWindows).toBe(beforeWindows)
    expect(capture.popups).toEqual([])
    facts.navigationIsolation = { appUrlStable: true, popupCount: capture.popups.length }
    steps.push('isolation-refute-ok')

    // ---------- 不静态冒充: 动态脚本真实执行 ----------
    // fixture flow-page / camera-page 的 script 已经给 counter / camera-frame 写过值.
    // script-generated-copy 是 script 写入的动态文本, 静态 HTML 中为空 → 验证动态执行.
    // 回到 three-sections 页签 (当前在 security-one)
    await page.locator('.workspace-document-tabs').getByRole('tab', { name: /^three-sections\.html/ }).click()
    await expect(region).toBeVisible()
    const camera = preview.locator('#camera-page [data-camera-track]')
    await toolbar.getByRole('button', { name: '下一页', exact: true }).click()
    await expect(toolbar).toContainText('3 / 3')
    await expect.poll(() => camera.getAttribute('data-camera-frame').then(value => Number(value))).toBeGreaterThan(0)
    const dynamicText = await preview.locator('#script-generated-copy').evaluate(el => el.textContent ?? '')
    expect(dynamicText).toBe('脚本生成的文字不能直接编辑')
    facts.dynamicExecution = { cameraFrame: Number(await camera.getAttribute('data-camera-frame')), dynamicText }
    steps.push('dynamic-script-ok')

    // ---------- 离线播放器兼容: 同一 lease URL 在独立 sandbox BrowserWindow 中加载, 无 Node/凭据 ----------
    const previewLeaseUrl = await region.locator('iframe[title="HTML 预览"]').getAttribute('src')
    expect(previewLeaseUrl).toMatch(/^courseware-preview:\/\/[a-f0-9]{32}\.[a-f0-9]{32}\.app\//)
    const standalone = await app.evaluate(async ({ BrowserWindow }, url) => {
      const win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, preload: undefined } })
      await win.loadURL(url!)
      // extract features
      const result = await win.webContents.executeJavaScript(`(() => ({
        hasDesktopAPI: typeof window.desktopAPI !== 'undefined',
        hasRequire: typeof window.require !== 'undefined',
        hasProcess: typeof window.process !== 'undefined',
        title: document.title,
        counterButtons: document.querySelectorAll('.counter-widget button').length,
        directSections: document.querySelectorAll('body > main > section').length,
        pageIndexSet: Array.from(document.querySelectorAll('body > main > section')).map(s => s.id),
      }))()`)
      win.destroy()
      return result
    }, previewLeaseUrl!)
    facts.offlinePlayer = standalone
    expect(standalone.hasDesktopAPI).toBe(false)
    expect(standalone.hasRequire).toBe(false)
    expect(standalone.hasProcess).toBe(false)
    expect(standalone.directSections).toBe(3)
    expect(standalone.counterButtons).toBeGreaterThanOrEqual(2)
    steps.push('offline-player-compat-ok')

    // ---------- 页面错误栏 / 控制台无页面错误 ----------
    expect(capture.pageErrors).toEqual([])
    facts.status = 'passed'
    await m23Shot(fixture, page, info, 'm25-t03-final', app)
  } catch (error) {
    failure = error; facts.status = 'failed'; throw error
  } finally {
    if (app && page && capture) {
      await m23Shot(fixture, page, info, failure ? 'failure' : 'm25-t03-result')
      const evidence = await writeM23Evidence(fixture, page, app, capture, facts, failure)
      await info.attach('M25-T03 evidence.json', { path: evidence, contentType: 'application/json' })
      await closeM23(app)
    }
  }
})
