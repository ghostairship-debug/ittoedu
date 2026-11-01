// @vitest-environment node
import { expect, it } from 'vitest'
import { chromium, expect as uiExpect, type BrowserContext, type Page } from '@playwright/test'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { installOasisAudioProbe, recordOasisAudioClip } from '../fixtures/creation/oasisAudioProbe'

const reportPath = process.env.OASIS_REPAIR_REPORT
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

/** Copy an already closed test profile without using the Windows cpSync path. */
async function copyClosedProfile(source: string, target: string) {
  const omitted = new Set(['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile', 'LOCK', 'DevToolsActivePort'])
  const copied = { files: 0, bytes: 0 }
  const visit = async (from: string, to: string) => {
    await mkdir(to, { recursive: true })
    for (const entry of await readdir(from, { withFileTypes: true })) {
      if (omitted.has(entry.name)) continue
      const input = join(from, entry.name), output = join(to, entry.name)
      if (entry.isDirectory()) await visit(input, output)
      else if (entry.isFile()) { const bytes = await readFile(input); await writeFile(output, bytes); copied.files++; copied.bytes += bytes.length }
      else if (entry.isSymbolicLink()) throw new Error(`Unexpected non-lock symlink in closed test profile: ${input}`)
    }
  }
  await visit(source, target)
  return copied
}

/** No generated replacement task: all clicks operate the retained original modules. */
it.skipIf(!reportPath)('records original sound, narration, captions and mute through actual Chromium output', async () => {
  const prepared = JSON.parse(await readFile(reportPath!, 'utf8'))
  const directory = process.env.OASIS_AUDIO_OUT ?? join(dirname(reportPath!), `audio-consumer-${Date.now()}`)
  const completedProfile = process.env.OASIS_AUDIO_PROFILE_SOURCE ?? join(dirname(reportPath!), 'offline-consumer-profile')
  await mkdir(directory, { recursive: true })
  const before = hash(await readFile(prepared.compiled)), clips: any[] = [], errors: any[] = [], requests: string[] = [], failedRequests: any[] = []
  let context: BrowserContext | undefined, page: Page | undefined
  const open = async (profile: string, scenario: string) => {
    context = await chromium.launchPersistentContext(profile, { headless: true, viewport: { width: 1440, height: 1000 },
      reducedMotion: 'reduce', ignoreDefaultArgs: ['--mute-audio'] })
    // Autoplay policy stays intact. Only the real click handlers may unlock audio.
    await context.addInitScript(installOasisAudioProbe)
    await context.setOffline(true); context.setDefaultTimeout(12_000)
    context.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()) })
    context.on('requestfailed', request => failedRequests.push({ scenario,
      url: request.url().startsWith('data:') ? `${request.url().slice(0, 60)}…` : request.url().slice(0, 300), error: request.failure()?.errorText }))
    context.on('page', page => page.on('pageerror', error => errors.push({ scenario, message: error.message })))
    page = await context.newPage(); await page.goto(pathToFileURL(prepared.compiled).href)
    await page.waitForFunction(() => Boolean((window as any).coursePlayer) || Boolean((window as any).__coursePlaybackFailed), undefined, { timeout: 20_000 })
    expect(await page.evaluate(() => (window as any).__coursePlaybackFailed ?? false)).toBe(false)
    const content = page.frameLocator('iframe').first()
    await uiExpect(content.locator('#start-button')).toBeEnabled({ timeout: 20_000 })
    return content
  }
  try {
    let content = await open(join(directory, 'fresh-profile'), 'intro-and-mute')
    await uiExpect(content.locator('#home-sound')).toHaveAttribute('aria-pressed', 'false')
    const ambience = await recordOasisAudioClip(content, directory, '01-home-ambience', async () => {
      await content.locator('#home-sound').click()
      await uiExpect(content.locator('#home-sound')).toHaveAttribute('aria-pressed', 'true')
    }, { captureMs: 2500 })
    clips.push(ambience)
    await content.locator('#start-button').click()
    await uiExpect(content.locator('[data-action="power"]')).toBeVisible()
    let introSubtitle = '', subtitleSurvivedMute = false, subtitleDismissed = false
    const intro = await recordOasisAudioClip(content, directory, '02-intro-narration', async () => {
      await content.locator('[data-action="power"]').click()
      await uiExpect(content.locator('#subtitles')).toBeVisible()
      introSubtitle = await content.locator('#subtitle-text').innerText()
      await page!.screenshot({ path: join(directory, '02-intro-narration.png') })
    }, { captureMs: 6000, voiceWaitMs: 4000 })
    clips.push(intro)
    const muted = await recordOasisAudioClip(content, directory, '03-muted', async () => {
      await content.locator('#mission-sound').click()
      await uiExpect(content.locator('#mission-sound')).toHaveAttribute('aria-pressed', 'false')
      subtitleSurvivedMute = await content.locator('#subtitles').isVisible()
      if (subtitleSurvivedMute) {
        await content.locator('#dismiss-subtitle').click()
        await uiExpect(content.locator('#subtitles')).toBeHidden(); subtitleDismissed = true
      }
      await page!.screenshot({ path: join(directory, '03-muted.png') })
    }, { captureMs: 2200, settleMs: 300 })
    clips.push(muted)
    const enabledAgain = await recordOasisAudioClip(content, directory, '04-enabled-again', async () => {
      await content.locator('#mission-sound').click()
      await uiExpect(content.locator('#mission-sound')).toHaveAttribute('aria-pressed', 'true')
      await content.locator('[data-action="step"]').click()
    }, { captureMs: 2200 })
    clips.push(enabledAgain)
    await context!.close(); context = undefined; page = undefined

    const copiedProfile = await copyClosedProfile(completedProfile, join(directory, 'completed-profile-copy'))
    content = await open(join(directory, 'completed-profile-copy'), 'completed-ecology')
    await uiExpect(content.locator('#continue-button')).toBeEnabled()
    if (await content.locator('#home-sound').getAttribute('aria-pressed') !== 'true') await content.locator('#home-sound').click()
    await content.locator('#continue-button').click()
    await uiExpect(content.locator('#stage-heading')).toHaveText('带回证据，重新看见')
    await content.locator('#route-list button').nth(3).click()
    await uiExpect(content.locator('[data-action="submit"]')).toBeEnabled()
    await uiExpect(content.locator('#mission-sound')).toHaveAttribute('aria-pressed', 'true')
    let ecologySubtitle = ''
    const ecology = await recordOasisAudioClip(content, directory, '05-ecology-narration', async () => {
      await content.locator('[data-action="submit"]').click()
      await uiExpect(content.locator('#subtitles')).toBeVisible()
      ecologySubtitle = await content.locator('#subtitle-text').innerText()
      await page!.screenshot({ path: join(directory, '05-ecology-narration.png') })
    }, { captureMs: 6000, voiceWaitMs: 4000 })
    clips.push(ecology)
    const checks = {
      ambienceHasRealOutput: (ambience.metrics?.rms ?? 0) > 0.00001,
      introHasActualDecodedVoiceStart: intro.voiceStarts.length > 0,
      introHasRecordedOutput: intro.recordings.some((value: any) => (value.pcm?.rms ?? 0) > 0.00001),
      mutedOutputStopped: muted.metrics?.maxActiveContexts === 0 || (muted.metrics?.rms !== null && muted.metrics?.rms < 0.000001),
      subtitleVisibleDuringNarration: introSubtitle.includes('3200米'), subtitleSurvivedMute, subtitleDismissed,
      enabledAgainHasRealOutput: (enabledAgain.metrics?.rms ?? 0) > 0.00001,
      ecologyHasActualDecodedVoiceStart: ecology.voiceStarts.length > 0,
      ecologySubtitleVisible: ecologySubtitle.includes('无光'),
      htmlUnchanged: hash(await readFile(prepared.compiled)) === before,
      offline: requests.length === 0, noPageErrors: errors.length === 0,
    }
    const result = { passed: Object.values(checks).every(Boolean), checks, clips, introSubtitle, ecologySubtitle,
      copiedProfile: { source: completedProfile, ...copiedProfile }, requests, failedRequests, errors,
      returnVoice: 'Not triggered from already-finished profile: the real delivered UI has no retry after finishDelivered. Final-version full-path consumer will record its final return step.',
      hearingReview: 'Actual output clips are retained; perceptual quality has not been assessed by this automated test.', modelCalls: 0 }
    await writeFile(join(directory, 'audio-consumer-result.json'), JSON.stringify(result, null, 2))
    expect(checks, 'Read audio-consumer-result.json and actual clips; do not infer speech from captions or ambience alone').toEqual(
      Object.fromEntries(Object.keys(checks).map(key => [key, true])))
  } catch (error) {
    if (page && !page.isClosed()) {
      await page.screenshot({ path: join(directory, 'audio-consumer-failure.png') }).catch(() => {})
      await writeFile(join(directory, 'audio-consumer-failure.json'), JSON.stringify({ error: String(error), errors, requests, failedRequests,
        frames: await Promise.all(page.frames().map(async frame => ({ url: frame.url().slice(0, 200), text: (await frame.locator('body').innerText().catch(() => '')).slice(0, 5000) }))) }, null, 2))
    }
    throw error
  } finally { await context?.close() }
}, 120_000)
