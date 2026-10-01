import { expect, test, type Locator } from '@playwright/test'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { m23Fixture } from './helpers/g20M23Fixtures'
import { chooseM23Workspace, closeM23, launchM23, m23Shot, openM23Html } from './helpers/g20M23Harness'

async function buttonAppearance(button: Locator) {
  return button.evaluate(element => {
    const computed = getComputedStyle(element)
    const properties = ['color', 'background', 'background-color', 'background-image', 'border-color', 'opacity', 'filter', 'transition', 'box-shadow']
    const matchedRules: Array<{ source: string; selector: string; declarations: string }> = []
    const inaccessibleSources: string[] = []
    const visit = (rules: CSSRuleList, source: string) => {
      for (const rule of Array.from(rules)) {
        if (rule instanceof CSSStyleRule) {
          if (element.matches(rule.selectorText) && properties.some(property => rule.style.getPropertyValue(property))) {
            matchedRules.push({ source, selector: rule.selectorText, declarations: rule.style.cssText })
          }
        } else if ('cssRules' in rule) visit((rule as CSSGroupingRule).cssRules, source)
      }
    }
    for (const sheet of Array.from(document.styleSheets)) {
      try { visit(sheet.cssRules, sheet.href ?? 'inline') } catch { inaccessibleSources.push(sheet.href ?? 'inline') }
    }
    const colorChannels = (value: string) => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number)
    const luminance = (channels: number[]) => channels.reduce((sum, value, index) => {
      const channel = value / 255
      return sum + (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4) * [0.2126, 0.7152, 0.0722][index]
    }, 0)
    const foreground = luminance(colorChannels(computed.color))
    const background = luminance(colorChannels(computed.backgroundColor))
    return {
      text: element.textContent, ariaPressed: element.getAttribute('aria-pressed'), disabled: (element as HTMLButtonElement).disabled,
      hovered: element.matches(':hover'), focused: element.matches(':focus'),
      computed: Object.fromEntries(properties.map(property => [property, computed.getPropertyValue(property)])),
      colorContrast: (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05),
      matchedRules, inaccessibleSources,
    }
  })
}

test('HTML authoring toolbar shows readable edit state and a reachable file menu', async ({}, info) => {
  const fixture = m23Fixture('authoring-surface-design-20261001')
  const runtime = await launchM23(fixture)
  const facts: Record<string, unknown> = { runDirectory: fixture.directory, scope: 'Current local build, one existing HTML fixture; no model call or document mutation.' }
  try {
    await chooseM23Workspace(runtime.app, runtime.page, fixture.workspace)
    const editor = await openM23Html(runtime.page, 'light-edit.html')
    const edit = editor.getByRole('button', { name: '编辑预览', exact: true })
    await expect(edit).toBeEnabled()
    facts.beforeEdit = await buttonAppearance(edit)
    await edit.click()
    const finish = editor.getByRole('button', { name: '完成编辑', exact: true })
    await expect(finish).toHaveAttribute('aria-pressed', 'true')
    await expect(finish).toBeEnabled()
    facts.editHovered = await buttonAppearance(finish)
    await m23Shot(fixture, runtime.page, info, '01-edit-hovered', runtime.app)
    await finish.evaluate(element => Promise.all(element.getAnimations().map(animation => animation.finished.catch(() => undefined))))
    facts.editHoveredStable = await buttonAppearance(finish)
    await runtime.page.mouse.move(2, 2)
    facts.editResting = await buttonAppearance(finish)
    facts.geometry = await runtime.page.evaluate(() => {
      const rect = (selector: string) => {
        const element = document.querySelector(selector)
        if (!element) return null
        const bounds = element.getBoundingClientRect(), style = getComputedStyle(element)
        return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, paddingTop: style.paddingTop, paddingBottom: style.paddingBottom }
      }
      const tabs = rect('.workspace-document-tabs'), toolbar = rect('.html-preview-pane__toolbar'), frame = rect('iframe[title="HTML 预览"]')
      return { viewport: { width: innerWidth, height: innerHeight }, tabs, toolbar, tabBody: rect('.lesson-file-tab--html'), frame,
        tabsThroughToolbarHeight: tabs && frame ? frame.y - tabs.y : null }
    })
    await m23Shot(fixture, runtime.page, info, '02-edit-resting', runtime.app)
    await editor.getByLabel('文档更多操作', { exact: true }).click()
    const saveAs = editor.getByRole('button', { name: '另存为', exact: true })
    await expect(saveAs).toBeVisible()
    await expect(saveAs).toBeEnabled()
    await saveAs.click({ trial: true })
    facts.fileMenu = { saveAsVisible: true, saveAsEnabled: true, saveAsHitTestPassed: true, bounds: await saveAs.boundingBox() }
    await runtime.page.mouse.move(2, 2)
    await m23Shot(fixture, runtime.page, info, '03-file-menu', runtime.app)
    expect((facts.editHovered as { colorContrast: number }).colorContrast, 'Finish-edit text should be legible immediately when its state changes').toBeGreaterThanOrEqual(4.5)
    expect((facts.editResting as { colorContrast: number }).colorContrast, 'Resting finish-edit text should be legible').toBeGreaterThanOrEqual(4.5)
  } catch (error) {
    facts.failure = error instanceof Error ? error.stack ?? error.message : String(error)
    throw error
  } finally {
    facts.runtime = runtime.capture
    writeFileSync(join(fixture.directory, 'evidence.json'), JSON.stringify(facts, null, 2) + '\n', 'utf8')
    await info.attach('Authoring surface evidence', { path: join(fixture.directory, 'evidence.json'), contentType: 'application/json' })
    await closeM23(runtime.app)
  }
})
