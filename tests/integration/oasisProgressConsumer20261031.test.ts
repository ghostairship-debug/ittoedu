// @vitest-environment node
import { expect, it } from 'vitest'
import { chromium, expect as uiExpect, type BrowserContext, type FrameLocator, type Page } from '@playwright/test'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { installOasisAudioProbe, recordOasisAudioClip } from '../fixtures/creation/oasisAudioProbe'

const reportPath = process.env.OASIS_REPAIR_REPORT
const captureAudio = process.env.OASIS_CAPTURE_AUDIO === '1'
const namespace = 'glimmer.unlit-oasis.save.v1'
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

/** Opt-in consumer of the user's retained original work, not an invented module stub. */
it.skipIf(!reportPath)('plays the original five acts, restores meaningful offline progress, and explicitly starts a new voyage', async () => {
  const prepared = JSON.parse(await fs.readFile(reportPath!, 'utf8'))
  const directory = process.env.OASIS_CONSUMER_OUT ?? path.join(path.dirname(reportPath!), `consumer-${Date.now()}`)
  await fs.mkdir(directory, { recursive: true })
  const profile = path.join(directory, 'offline-consumer-profile')
  const errors: string[] = [], network: string[] = [], checkpoints: unknown[] = []
  const audioClips: any[] = []
  let context: BrowserContext
  const open = async () => {
    context = await chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce',
      ...(captureAudio ? { ignoreDefaultArgs: ['--mute-audio'] } : {}) })
    if (captureAudio) await context.addInitScript(installOasisAudioProbe)
    await context.setOffline(true)
    context.setDefaultTimeout(12_000)
    context.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()) })
    context.on('page', page => page.on('pageerror', error => errors.push(error.message)))
    const page = await context.newPage()
    await page.goto(pathToFileURL(prepared.compiled).href)
    await page.waitForFunction(() => Boolean((window as any).coursePlayer) || Boolean((window as any).__coursePlaybackFailed), undefined, { timeout: 20_000 })
    expect(await page.evaluate(() => (window as any).__coursePlaybackFailed ?? false)).toBe(false)
    const content = page.frameLocator('iframe').first()
    await uiExpect(content.locator('#start-button')).toBeEnabled({ timeout: 20_000 })
    return { page, content }
  }
  const readStored = async (page: Page): Promise<any> => page.evaluate(async ({ namespace, workId }) => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('guoling-learning-progress-v1', 1)
      request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error)
    })
    try {
      const location = new URL(window.location.href); location.hash = ''; location.search = ''
      return await new Promise((resolve, reject) => {
        const request = database.transaction('snapshots', 'readonly').objectStore('snapshots').get(JSON.stringify([location.href, workId, namespace]))
        request.onsuccess = () => resolve(request.result?.value); request.onerror = () => reject(request.error)
      })
    } finally { database.close() }
  }, { namespace, workId: prepared.repairedProjectId })
  const checkpoint = async (page: Page, content: FrameLocator, name: string) => {
    await uiExpect(content.locator('#save-indicator')).toHaveText('已在本设备保存')
    const stored = await readStored(page)
    checkpoints.push({ name, stored })
    await fs.writeFile(path.join(directory, 'consumer-checkpoints.json'), JSON.stringify(checkpoints, null, 2))
    await page.screenshot({ path: path.join(directory, `${name}.png`) })
    return stored
  }
  const range = async (content: FrameLocator, selector: string, value: number, event: 'input' | 'change' = 'input') => {
    // Set only the public range control and dispatch its ordinary input event.
    // Physics, completion, saved state and navigation remain authored runtime behavior.
    await content.locator(selector).evaluate((element, input) => {
      const slider = element as HTMLInputElement
      if (slider.disabled || slider.type !== 'range') throw new Error('Expected enabled range input')
      slider.value = String(input.value); slider.dispatchEvent(new Event(input.event, { bubbles: true }))
    }, { value, event })
  }
  let page: Page | undefined, content: FrameLocator | undefined
  const narration = async (name: string, action: () => Promise<void>) => {
    if (!captureAudio) return action()
    if (await content!.locator('#mission-sound').getAttribute('aria-pressed') !== 'true') await content!.locator('#mission-sound').click()
    const clip = await recordOasisAudioClip(content!, path.join(directory, 'actual-audio'), name, action,
      { captureMs: 18_000, voiceWaitMs: 4000 })
    audioClips.push(clip)
    await fs.writeFile(path.join(directory, 'actual-audio-result.json'), JSON.stringify(audioClips, null, 2))
    expect(clip.voiceStarts.length, `${name} must start a real decoded narration buffer`).toBeGreaterThan(0)
    expect(clip.recordings.some((recording: any) => recording.pcm?.rms > 0.00001)).toBe(true)
    expect(clip.after.errors).toEqual([])
  }
  try {
    ;({ page, content } = await open())
    await content.locator('#start-button').click()
    await narration('intro', () => content!.locator('[data-action="power"]').click())
    await content.locator('[data-action="skip"]').click()
    for (const [index, choice] of ['fact', 'inference', 'open'].entries()) {
      await content.locator(`[data-action="record-${index}"]`).click()
      await content.locator(`[data-action="class-${choice}"]`).click()
    }
    await content.locator('[data-action="seal"]').click()
    await uiExpect(content.locator('#next-button')).toBeEnabled()
    const intro = await checkpoint(page, content, '01-intro-sealed')
    expect(intro.modules.intro.initialRecords).toHaveLength(3)
    expect(intro.completed.intro).toBeTruthy()

    // Actual refresh restores inputs and completion, then allows the next step.
    await page.reload(); content = page.frameLocator('iframe').first()
    await uiExpect(content.locator('#continue-button')).toBeEnabled({ timeout: 20_000 })
    await content.locator('#continue-button').click()
    await uiExpect(content.locator('#next-button')).toBeEnabled()
    const afterRefresh = await checkpoint(page, content, '02-intro-refreshed')
    expect(afterRefresh.modules.intro.initialRecords).toEqual(intro.modules.intro.initialRecords)
    expect(afterRefresh.completed.intro).toEqual(intro.completed.intro)
    await content.locator('#next-button').click()

    await content.locator('[data-predict="down"]').click()
    await content.locator('[data-action="verify"]').click()
    await content.locator('[data-action="pause"]').click()
    for (let index = 0; index < 180 && await content.locator('[data-action="sample"]').isDisabled(); index++) {
      const depth = Number(await content.locator('[data-depth]').innerText())
      const velocityText = await content.locator('[data-velocity]').innerText()
      const velocity = Number(velocityText.replace(/[^0-9.]/g, '')) * (velocityText.includes('↑') ? -1 : 1)
      const target = Math.max(-0.35, Math.min(0.35, (3200 - depth) * 0.35))
      const ballast = Math.abs(3200 - depth) < 0.35 ? 60 : Math.max(0, Math.min(120,
        Math.round(60 + ((target - velocity) * 1025 + 500 * velocity + 350 * velocity * Math.abs(velocity)) / 9.8)))
      await range(content, '[data-ballast]', ballast)
      await content.locator('[data-action="step"]').click()
    }
    await uiExpect(content.locator('[data-action="sample"]')).toBeEnabled()
    await content.locator('[data-action="sample"]').click()
    await content.locator('[data-reason="drag"]').click()
    await content.locator('[data-action="trial"]').click()
    await uiExpect(content.locator('#next-button')).toBeEnabled({ timeout: 8000 })
    const buoyancy = await checkpoint(page, content, '03-buoyancy-complete')
    expect(buoyancy.modules.buoyancy.sample.stableSeconds).toBe(3)
    expect(buoyancy.modules.buoyancy.done).toBe(true)
    await content.locator('#next-button').click()

    for (const [index, radius] of [600, 450, 300].entries()) {
      await content.locator(`button[data-point="${index}"]`).first().click()
      await content.locator('[data-action="ping"]').click()
      if (index === 0) {
        await content.locator('input[data-radius][type="number"]').fill('400')
        await content.locator('[data-action="confirm"]').click()
        await uiExpect(content.locator('[data-feedback]')).toContainText('偏小')
        await uiExpect(content.locator('#next-button')).toBeDisabled()
      }
      await content.locator('input[data-radius][type="number"]').fill(String(radius))
      await content.locator('[data-action="confirm"]').click()
    }
    await content.locator('[data-coord="x"]').fill('850'); await content.locator('[data-coord="y"]').fill('700')
    await content.locator('[data-action="locate"]').click()
    await content.locator('input[data-correction][type="number"]').fill('900')
    await content.locator('[data-action="correct"]').click()
    const sonar = await checkpoint(page, content, '04-sonar-complete')
    expect(sonar.modules.sonar.target).toMatchObject({ x: 850, y: 700, coordinateSystem: 'sonar-local-east-north', valid: true })
    expect(sonar.modules.sonar.correction).toBe(900)
    // Close the entire browser, including its storage process, and reuse the same actual file/profile.
    await context!.close(); ({ page, content } = await open())
    await content.locator('#continue-button').click()
    await uiExpect(content.locator('#stage-heading')).toHaveText('听见看不见的站')
    await uiExpect(content.locator('#next-button')).toBeEnabled()
    expect((await readStored(page)).modules.sonar).toEqual(sonar.modules.sonar)
    await checkpoint(page, content, '05-sonar-browser-reopened')
    await content.locator('#next-button').click()

    for (const [from, to, kind] of [['c', 'p', 'matter'], ['r', 'p', 'energy'], ['p', 'g', 'energy']]) {
      await content.locator('[data-action="from"]').click()
      await content.locator(`button[data-node="${from}"]`).click()
      await content.locator(`button[data-node="${to}"]`).click()
      await content.locator(`[data-type="${kind}"]`).click()
      await content.locator('[data-action="connect"]').click()
    }
    await content.locator('[data-pred="up"]').click(); await content.locator('[data-action="run"]').click()
    await uiExpect(content.locator('[data-view="records"]')).toContainText('60 / 65 / 65')
    await range(content, '[data-supply="o"]', 20, 'input')
    await content.locator('[data-pred="down"]').click(); await content.locator('[data-action="run"]').click()
    await uiExpect(content.locator('[data-explain="direction"]')).toBeEnabled()
    await content.locator('[data-explain="direction"]').selectOption('down')
    await content.locator('[data-explain="cause"]').selectOption('oxidantLow')
    await content.locator('[data-explain="flow"]').selectOption('oneway')
    await narration('ecology', () => content!.locator('[data-action="submit"]').click())
    await uiExpect(content.locator('#next-button')).toBeEnabled()
    const ecology = await checkpoint(page, content, '06-ecology-complete')
    expect(ecology.modules.eco.comparison.supplies.o).toBe(20)
    expect(ecology.modules.eco.comparison.series).toHaveLength(25)
    await content.locator('#next-button').click()

    await uiExpect(content.locator('#module-host')).toContainText('850')
    await uiExpect(content.locator('#module-host')).toContainText('700')
    for (let index = 0; index < 3; index++) await content.locator(`[data-act="scan"][data-i="${index}"]`).click()
    await content.locator('[data-act="preset"][data-key="north"]').click()
    await content.locator('[data-act="depart"]').click()
    for (let index = 0; index < 4; index++) await content.locator('[data-act="sail"]').click()
    await range(content, '[data-ballast]', 60, 'change')
    await content.locator('[data-act="tick"]').click(); await content.locator('[data-act="tick"]').click()
    for (let index = 0; index < 3; index++) await content.locator('[data-act="recover"]').click()
    await range(content, '[data-ballast]', 40, 'change')
    await content.locator('[data-act="tick"]').click(); await content.locator('[data-act="tick"]').click()
    await content.locator('[data-act="recover"]').click()
    for (let index = 0; index < 3; index++) await content.locator('[data-act="sail"]').click()
    await narration('return', () => content!.locator('[data-act="sail"]').click())
    await content.locator('[data-act="finish"]').click()
    await uiExpect(content.locator('#stage-heading')).toHaveText('带回证据，重新看见')
    const final = await checkpoint(page, content, '07-debrief')
    expect(Object.keys(final.completed)).toEqual(['intro', 'buoyancy', 'sonar', 'eco', 'rescue'])
    expect(final.result.coreRecovered).toBe(true)
    expect(final.result.energy).toBeGreaterThan(0)
    expect(final.modules.intro.initialRecords).toEqual(intro.modules.intro.initialRecords)
    expect(final.result.evidence.sourceTarget).toMatchObject({ x: 850, y: 700 })
    await uiExpect(content.locator('[data-view="return-records"]')).toBeVisible()
    for (const field of ['distance', 'flightEnergy', 'operationEnergy'])
      await uiExpect(content.locator(`[data-record="${field}"]`)).toHaveAttribute('data-value', String(final.result[field]))
    await uiExpect(content.locator('[data-record="dataIntegrityExplanation"]')).toHaveText(final.result.dataIntegrityExplanation)
    await uiExpect(content.locator('body')).not.toContainText('终幕未附带逐项因果说明')
    await content.locator('[data-view="return-ledger"] summary').click()
    const records = await content.locator('tr[data-record="ledger"]').evaluateAll(rows => rows.map(row =>
      Object.fromEntries([...row.querySelectorAll('[data-ledger-field]')].map(cell =>
        [cell.getAttribute('data-ledger-field'), cell.getAttribute('data-value')]))))
    expect(records).toEqual(final.result.evidence.ledger.map((item: any) => Object.fromEntries(['energy', 'distance', 'disturbance']
      .map(key => [key, typeof item[key] === 'number' && Number.isFinite(item[key]) ? String(item[key]) : '']))))
    await page.screenshot({ path: path.join(directory, '07-debrief-records-expanded.png') })
    await content.locator('[data-view="return-ledger"] summary').click()

    await context!.close(); ({ page, content } = await open())
    await content.locator('#continue-button').click()
    await uiExpect(content.locator('#stage-heading')).toHaveText('带回证据，重新看见')
    expect((await readStored(page)).result).toEqual(final.result)
    await content.locator('#pause-button').click()
    await content.locator('#return-home-button').click()
    await content.locator('#start-button').click(); await content.locator('#confirm-restart-button').click()
    await uiExpect(content.locator('[data-action="power"]')).toBeVisible()
    const reset = await checkpoint(page, content, '08-explicit-new-voyage')
    expect(reset.completed).toEqual({}); expect(reset.result).toBeNull()
    expect(reset.modules.sonar).toBeUndefined()
    expect(digest(await fs.readFile(prepared.original))).toBe(prepared.originalHash)
    expect(digest(await fs.readFile(prepared.glx))).toBe(prepared.glxHash)
    expect(network).toEqual([]); expect(errors).toEqual([])
    await fs.writeFile(path.join(directory, 'consumer-result.json'), JSON.stringify({ passed: true, offline: true, realModules: true,
      meaningfulRefresh: true, browserClosedReopen: true, originalUnchanged: true, authorArchiveUnchangedByPlay: true,
      wholeMainPath: Object.keys(final.completed), necessaryErrorAndCorrection: 'sonar radius 400 rejected, then 600 accepted',
      debriefUsesExistingTerminalRecords: true, displayedLedgerCount: records.length,
      finalResult: final.result, initialRecords: final.modules.intro.initialRecords, resetPreventsOldProgress: true, network, errors,
      actualNarrationOutputRecorded: captureAudio ? audioClips.map(clip => ({ name: clip.name, voiceStarts: clip.voiceStarts, recordings: clip.recordings })) : [],
      audioListening: captureAudio ? 'Actual output retained for separate perceptual review' : 'separate real-audio review still required' }, null, 2))
  } catch (error) {
    if (page && !page.isClosed()) {
      await page.screenshot({ path: path.join(directory, 'consumer-failure.png') }).catch(() => undefined)
      await fs.writeFile(path.join(directory, 'consumer-failure.json'), JSON.stringify({ error: String(error), stack: error instanceof Error ? error.stack : '',
        stored: await readStored(page).catch(() => null), frames: await Promise.all(page.frames().map(async frame => ({ url: frame.url(), text: await frame.locator('body').innerText().catch(() => '') }))), errors, network }, null, 2))
    }
    throw error
  } finally { await context!.close().catch(() => undefined) }
}, 240_000)
