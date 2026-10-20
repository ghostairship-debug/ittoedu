import { _electron as electron, expect, test } from '@playwright/test'
import { build } from 'esbuild'
import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

test('Published observation uses trusted click/fill/range in one persistent task worker', async () => {
  test.setTimeout(90_000)
  const root = path.resolve(__dirname, '../..'), base = path.join(root, 'output/authoring-followup-20261017/view-actions-electron')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(path.join(base, 'run-'))
  // Consume the one final renderer build; this spec never rebuilds the product.
  await symlink(path.join(root, 'dist-renderer'), path.join(directory, 'dist-renderer'), 'junction')
  await build({ entryPoints: [path.join(__dirname, 'helpers/publishedViewActionsMain20261017.ts')], outfile: path.join(directory, 'main.cjs'),
    bundle: true, platform: 'node', format: 'cjs', packages: 'external' })
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ args: [path.join(directory, 'main.cjs')], env: { ...env, VIEW_ACTIONS_FIXTURE_DIR: directory } })
  try {
    const facts = await app.evaluate(async () => Reflect.get(globalThis, 'runPublishedViewActions')())
    await writeFile(path.join(directory, 'facts.json'), JSON.stringify(facts, null, 2))
    expect(facts).toMatchObject({ source: 'isolated-published',
      first: 'State: clicks=0; answer=; power=0; trusted=false/false/false',
      clicked: 'State: clicks=1; answer=; power=0; trusted=true/false/false',
      adjusted: 'State: clicks=1; answer=actual input; power=7; trusted=true/true/true',
      returned: 'State: clicks=1; answer=actual input; power=7; trusted=true/true/true',
      secondLocation: 'second', returnedLocation: 'first', sameWorker: true, oneWindowForPages: true,
      repeatedOnlyOnce: true, paintedPower7: true, returnedPaintedPower7: true, newWorkerAfterClose: true, closedTargetRejected: true, spentRejected: true, stopRejected: true,
      emptyFrameSkipped: true, hostBootstrapShortUrl: true,
      windowsRestored: true, document: { revision: 0, undoDepth: 0, data: {} } })
    for (const [name, design, image] of [
      ['first', { width: 800, height: 500 }, facts.firstImage],
      ['second', { width: 960, height: 540 }, facts.secondImage],
      ['returned', { width: 800, height: 500 }, facts.returnedImageSize],
    ] as const) {
      const viewport = facts.viewports[name]
      expect(viewport.visible).toBe(false)
      expect(viewport.observed).toEqual({ width: viewport.actual.width, height: viewport.actual.height })
      expect(viewport.contentSize).toEqual([viewport.actual.width, viewport.actual.height])
      // Native Windows content sizing may round by one CSS pixel at fractional DPI.
      expect(Math.abs(viewport.actual.width - design.width)).toBeLessThanOrEqual(1)
      expect(Math.abs(viewport.actual.height - design.height)).toBeLessThanOrEqual(1)
      // A physical-pixel PNG covers the same full CSS viewport, without an extra crop.
      expect(image.width).toBe(Math.round(viewport.actual.width * viewport.actual.scale))
      expect(image.height).toBe(Math.round(viewport.actual.height * viewport.actual.scale))
    }
    expect(facts.nestedFrames).toBeGreaterThan(1)
    const bootstrapReports = facts.reportedFrameUrls.filter((value: string) => new URL(value).pathname.includes('/bootstrap/'))
    expect(bootstrapReports.length).toBeGreaterThan(0)
    for (const value of bootstrapReports) expect(new URL(value).searchParams.has('html')).toBe(false)
    expect(facts.reopened).toBe(facts.first)
  } finally { await app.close() }
})

test('Published rainfall range reaches 40 with its real shared-state repaint loop', async () => {
  test.setTimeout(90_000)
  const root = path.resolve(__dirname, '../..'), base = path.join(root, 'output/authoring-followup-20261017/rain-range-electron')
  await mkdir(base, { recursive: true })
  const directory = await mkdtemp(path.join(base, 'run-'))
  await symlink(path.join(root, 'dist-renderer'), path.join(directory, 'dist-renderer'), 'junction')
  await build({ entryPoints: [path.join(__dirname, 'helpers/publishedViewActionsMain20261017.ts')], outfile: path.join(directory, 'main.cjs'),
    bundle: true, platform: 'node', format: 'cjs', packages: 'external' })
  const env = Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
  delete env.ELECTRON_RUN_AS_NODE
  const app = await electron.launch({ args: [path.join(directory, 'main.cjs')], env: { ...env, VIEW_ACTIONS_FIXTURE_DIR: directory } })
  try {
    const facts = await app.evaluate(async () => Reflect.get(globalThis, 'runPublishedRainRangeRegression')())
    await writeFile(path.join(directory, 'facts.json'), JSON.stringify(facts, null, 2))
    for (const [index, attempt] of facts.attempts.entries()) {
      expect(attempt.error, JSON.stringify({ index, trace: attempt.trace })).toBeNull()
      expect(attempt).toMatchObject({ value: '40', total: '4000', infiltration: '800', runoff: '3200' })
      expect(attempt.trace.some((event: { type: string; trusted?: boolean }) => event.type === 'input' && event.trusted)).toBe(true)
    }
    expect(facts.attempts).toHaveLength(12)
    expect(facts.snapshots).toHaveLength(3)
    for (const snapshot of facts.snapshots) {
      expect(snapshot.actual).toBe(snapshot.requested)
      expect(snapshot.inputs).toEqual(expect.arrayContaining([
        { label: '降雨量P毫米', value: '40' }, { label: '硬化比例百分比', value: '40' },
        { label: '土壤入渗能力I毫米', value: snapshot.requested },
      ]))
      const wet = snapshot.requested === '30'
      expect(snapshot.values).toEqual(expect.arrayContaining(wet ? ['4000', '1800', '2200'] : ['4000', '1200', '2800']))
      // NativeImage pixels are BGRA: current DOM and the same receipt's PNG agree.
      expect(snapshot.color).toEqual(wet ? [150, 170, 50, 255] : [76, 179, 241, 255])
    }
  } finally { await app.close() }
})
