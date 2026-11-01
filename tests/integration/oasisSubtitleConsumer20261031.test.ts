// @vitest-environment node
import { expect, it } from 'vitest'
import { chromium, expect as uiExpect } from '@playwright/test'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { installOasisAudioProbe, recordOasisAudioClip } from '../fixtures/creation/oasisAudioProbe'

const reportPath = process.env.OASIS_REPAIR_REPORT
const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

/** Fresh-profile consumer: no earlier work's URL, save slot, or internal state is transplanted. */
it.skipIf(!reportPath)('keeps actual narration captions readable until dismissal or scene cleanup', async () => {
  const prepared = JSON.parse(await readFile(reportPath!, 'utf8'))
  const directory = process.env.OASIS_SUBTITLE_OUT ?? join(dirname(reportPath!), `subtitle-consumer-${Date.now()}`)
  await mkdir(directory, { recursive: true })
  const beforeHash = digest(await readFile(prepared.compiled)), requests: string[] = [], errors: string[] = []
  const context = await chromium.launchPersistentContext(join(directory, 'fresh-profile'), {
    headless: true, viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce', ignoreDefaultArgs: ['--mute-audio'],
  })
  await context.addInitScript(installOasisAudioProbe)
  await context.setOffline(true); context.setDefaultTimeout(12_000)
  context.on('request', request => { if (/^https?:/.test(request.url())) requests.push(request.url()) })
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)))
  const page = await context.newPage()
  let lateCaption: any, afterMute: any, afterDismiss: any, beforeNavigation: any, afterNavigation: any
  try {
    await page.goto(pathToFileURL(prepared.compiled).href)
    await page.waitForFunction(() => Boolean((window as any).coursePlayer) || Boolean((window as any).__coursePlaybackFailed),
      undefined, { timeout: 20_000 })
    expect(await page.evaluate(() => (window as any).__coursePlaybackFailed ?? false)).toBe(false)
    const content = page.frameLocator('iframe').first(), body = content.locator('body')
    const observe = () => body.evaluate(() => {
      const subtitles = document.getElementById('subtitles')!
      return { at: performance.now(), visible: !subtitles.hidden && subtitles.getClientRects().length > 0,
        text: document.getElementById('subtitle-text')!.textContent,
        audio: (window as any).__oasisAudioProbe.snapshot() }
    })
    await uiExpect(content.locator('#start-button')).toBeEnabled({ timeout: 20_000 })
    await content.locator('#home-sound').click()
    await uiExpect(content.locator('#home-sound')).toHaveAttribute('aria-pressed', 'true')
    await content.locator('#start-button').click()
    let firstCaption: any, legacyHideMs = 0
    const narration = await recordOasisAudioClip(content, directory, '01-intro-past-old-caption-timeout', async () => {
      await content.locator('[data-action="power"]').click()
      await uiExpect(content.locator('#subtitles')).toBeVisible()
      firstCaption = await observe()
      // This is the old defect's threshold, not a new product timing rule.
      legacyHideMs = Math.max(8000, Math.min(35000, firstCaption.text.length * 190))
      await body.evaluate((_body, milliseconds) => new Promise<void>(resolve => setTimeout(resolve, milliseconds)), legacyHideMs + 1000)
      lateCaption = await observe()
      await page.screenshot({ path: join(directory, '01-caption-after-original-timeout.png') })
    }, { captureMs: 10_000, voiceWaitMs: 4000 })

    const muted = await recordOasisAudioClip(content, directory, '02-muted-caption-retained', async () => {
      await content.locator('#mission-sound').click()
      await uiExpect(content.locator('#mission-sound')).toHaveAttribute('aria-pressed', 'false')
    }, { captureMs: 2200, settleMs: 300 })
    afterMute = await observe()
    await page.screenshot({ path: join(directory, '02-muted-caption-retained.png') })
    await content.locator('#dismiss-subtitle').click()
    await uiExpect(content.locator('#subtitles')).toBeHidden()
    afterDismiss = await observe()

    // Produce another caption only through the real new-voyage controls, then
    // finish the authored first-act choices and navigate to the second act.
    await content.locator('#mission-sound').click()
    await uiExpect(content.locator('#mission-sound')).toHaveAttribute('aria-pressed', 'true')
    await content.locator('#pause-button').click()
    await content.locator('#return-home-button').click()
    await content.locator('#start-button').click()
    await content.locator('#confirm-restart-button').click()
    await content.locator('[data-action="power"]').click()
    await uiExpect(content.locator('#subtitles')).toBeVisible()
    await content.locator('[data-action="skip"]').click()
    for (const [index, choice] of ['fact', 'inference', 'open'].entries()) {
      await content.locator(`[data-action="record-${index}"]`).click()
      await content.locator(`[data-action="class-${choice}"]`).click()
    }
    await content.locator('[data-action="seal"]').click()
    await uiExpect(content.locator('#next-button')).toBeEnabled()
    beforeNavigation = await observe()
    await content.locator('#next-button').click()
    await uiExpect(content.locator('#stage-heading')).toHaveText('让微光号停下来')
    await uiExpect(content.locator('#subtitles')).toBeHidden()
    afterNavigation = await observe()
    await page.screenshot({ path: join(directory, '03-second-act-caption-cleared.png') })

    const activeVoiceAtLateCaption = lateCaption.audio.voiceSources.find((voice: any) =>
      voice.contextState === 'running' && voice.endedAt === null && voice.loop === false &&
      voice.playbackRate === 1 && voice.detune === 0 && voice.contextTime >= voice.effectiveWhen &&
      voice.contextTime < voice.effectiveWhen + Math.min(voice.requestedDuration ?? Infinity, voice.duration - voice.offset))
    const checks = {
      measuredPastOriginalTimeout: lateCaption.at - firstCaption.at > legacyHideMs,
      narrationSourceStillPlaying: Boolean(activeVoiceAtLateCaption),
      captionVisiblePastOriginalTimeout: lateCaption.visible && lateCaption.text === firstCaption.text,
      actualNarrationOutputRecorded: narration.recordings.some((recording: any) => recording.pcm?.rms > 0.00001),
      captionSurvivesMute: afterMute.visible && afterMute.text === firstCaption.text,
      mutedOutputStopped: muted.metrics?.maxActiveContexts === 0 || (muted.metrics?.rms !== null && muted.metrics?.rms < 0.000001),
      explicitDismissClearsText: !afterDismiss.visible && afterDismiss.text === '',
      actualNavigationHadCaptionToClear: beforeNavigation.visible && beforeNavigation.text === firstCaption.text,
      sceneNavigationClearsText: !afterNavigation.visible && afterNavigation.text === '',
      originalUnchanged: digest(await readFile(prepared.original)) === prepared.originalHash,
      authorArchiveUnchanged: digest(await readFile(prepared.glx)) === prepared.glxHash,
      exportUnchanged: digest(await readFile(prepared.compiled)) === beforeHash,
      offline: requests.length === 0, noPageErrors: errors.length === 0,
    }
    await writeFile(join(directory, 'subtitle-consumer-result.json'), JSON.stringify({ passed: Object.values(checks).every(Boolean),
      checks, legacyHideMs, firstCaption, lateCaption, activeVoiceAtLateCaption, afterMute, afterDismiss, beforeNavigation, afterNavigation,
      recordings: [narration, muted], requests, errors, modelCalls: 0,
      hearingReview: 'Source lifecycle and real captured output are measured; no perceptual listening or spoken-word transcription is claimed.' }, null, 2))
    expect(checks).toEqual(Object.fromEntries(Object.keys(checks).map(key => [key, true])))
  } catch (error) {
    await page.screenshot({ path: join(directory, 'subtitle-consumer-failure.png') }).catch(() => {})
    await writeFile(join(directory, 'subtitle-consumer-failure.json'), JSON.stringify({ error: String(error), requests, errors,
      lateCaption, afterMute, afterDismiss, beforeNavigation, afterNavigation }, null, 2))
    throw error
  } finally { await context.close() }
}, 90_000)
