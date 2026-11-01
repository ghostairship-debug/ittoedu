/** Independent behavior checks of the saved built-in candidate. Never writes the source. */
import assert from 'node:assert/strict';
import { chromium, expect } from '@playwright/test';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const creation = path.resolve('output/comprehensive-execution-20261101/creation');
const source = path.resolve(process.argv[2] || path.join(creation, 'builtin-moon-normal-20261101T084000/workspace/月光的几何.html'));
const base = path.resolve(process.argv[3] || path.join(creation, 'builtin-moon-offline'));
const title = process.argv[4] || '月光的几何';
await fs.mkdir(base, { recursive: true });
const out = await fs.mkdtemp(path.join(base, 'run-'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const beforeHash = hash(await fs.readFile(source));
const browser = await chromium.launch();
const facts = [];

async function containing(page, selector) {
  let found;
  await expect.poll(async () => {
    for (const frame of page.frames()) {
      if (await frame.locator(selector).count().catch(() => 0)) { found = frame; return true; }
    }
    return false;
  }, { timeout: 20_000 }).toBe(true);
  return found;
}

// Compose real frame rectangles and validate every hit before a real pointer click.
// This also detects controls that exist in the DOM but are clipped by a parent.
async function clickAuthored(page, frame, selector) {
  const target = frame.locator(selector);
  await target.scrollIntoViewIfNeeded();
  let point = await target.evaluate(element => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  });
  const chain = [];
  for (let current = frame; current.parentFrame(); current = current.parentFrame()) {
    const owner = await current.frameElement();
    const geometry = await owner.evaluate(element => {
      const rect = element.getBoundingClientRect();
      return { left: rect.left, top: rect.top, sx: rect.width / element.offsetWidth, sy: rect.height / element.offsetHeight,
        bx: element.clientLeft, by: element.clientTop };
    });
    point = { x: geometry.left + (point.x + geometry.bx) * geometry.sx, y: geometry.top + (point.y + geometry.by) * geometry.sy };
    const hit = await owner.evaluate((element, position) => {
      const root = element.getRootNode();
      const found = typeof root.elementFromPoint === 'function' ? root.elementFromPoint(position.x, position.y)
        : element.ownerDocument.elementFromPoint(position.x, position.y);
      return found === element;
    }, point);
    assert.equal(hit, true, `Actual iframe hit for ${selector}`);
    chain.push({ point, geometry, hit });
  }
  await page.mouse.click(point.x, point.y);
  return chain;
}

try {
  for (const [width, height] of [[1440, 900], [900, 650], [390, 844]]) {
    const context = await browser.newContext({ viewport: { width, height }, offline: true });
    const page = await context.newPage(); page.setDefaultTimeout(10_000);
    const errors = [], network = [];
    const fact = { width, height, mode: width === 390 ? 'observation-only' : 'desktop-acceptance', errors, network,
      phases: [], pointerChecks: [], phase: 'load', passed: false };
    page.on('pageerror', error => errors.push(error.message));
    page.on('request', request => { if (/^https?:/.test(request.url())) network.push(request.url()); });
    try {
      const started = performance.now();
      await page.goto(pathToFileURL(source).href);
      await expect(page.getByText(title, { exact: true }).first()).toBeVisible({ timeout: 20_000 });
      const lab = await containing(page, '#angle');
      await expect(lab.locator('#phaseName')).toHaveText('新月');
      fact.loadMs = performance.now() - started;
      fact.outerGeometry = await page.evaluate(() => ({ width: innerWidth, height: innerHeight,
        scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight }));
      fact.labGeometry = await lab.evaluate(() => {
        const bounds = document.querySelector('.lab').getBoundingClientRect();
        return { width: innerWidth, height: innerHeight, scrollWidth: document.documentElement.scrollWidth,
          scrollHeight: document.documentElement.scrollHeight, bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height } };
      });
      await page.screenshot({ path: path.join(out, `overview-${width}.png`), fullPage: true });
      fact.phase = 'four-phases';
      const cases = [[0, '新月', '0%', 268, 130], [90, '上弦月', '50%', 174, 36],
        [180, '满月', '100%', 80, 130], [270, '下弦月', '50%', 174, 224]];
      for (const [angle, label, fraction, x, y] of cases) {
        const chain = await clickAuthored(page, lab, `[data-angle="${angle}"]`);
        await expect(lab.locator('#phaseName')).toHaveText(label);
        await expect(lab.locator('#fraction')).toHaveText(fraction);
        await expect(lab.locator('#angleOut')).toHaveText(`${angle}°`);
        await expect(lab.locator(`[data-angle="${angle}"]`)).toHaveAttribute('aria-pressed', 'true');
        const position = await lab.locator('#orbitalMoon').getAttribute('transform');
        const coordinates = position.match(/translate\(([-\d.]+)\s+([-\d.]+)\)/);
        assert.ok(coordinates && Math.abs(Number(coordinates[1]) - x) < .01 && Math.abs(Number(coordinates[2]) - y) < .01, 'Independent orbit geometry');
        fact.phases.push({ angle, label, fraction, litPath: await lab.locator('#lit').getAttribute('d'), position });
        fact.pointerChecks.push({ control: `phase-${angle}`, chain });
        if (angle === 180) await page.screenshot({ path: path.join(out, `full-moon-${width}.png`), fullPage: true });
      }
      assert.equal(new Set(fact.phases.map(item => item.litPath)).size, 4, 'All four moon silhouettes differ');
      fact.phase = 'slider-keyboard';
      await lab.locator('#angle').focus(); await page.keyboard.press('Home'); await page.keyboard.press('ArrowRight');
      await expect(lab.locator('#angleOut')).toHaveText('1°');
      fact.keyboardSlider = true;
      fact.phase = 'question-wrong-and-correct';
      fact.pointerChecks.push({ control: 'incorrect-answer', chain: await clickAuthored(page, lab, '[data-answer="right"]') });
      await expect(lab.locator('#feedback')).toHaveClass('feedback bad');
      await expect(lab.locator('#feedback')).toContainText('再想一想');
      fact.pointerChecks.push({ control: 'correct-answer', chain: await clickAuthored(page, lab, '[data-answer="wrong"]') });
      await expect(lab.locator('#feedback')).toHaveClass('feedback good');
      await expect(lab.locator('#feedback')).toContainText('回答正确');
      await page.screenshot({ path: path.join(out, `question-${width}.png`), fullPage: true });
      fact.phase = 'reset';
      fact.resetLabel = await lab.locator('#reset').innerText();
      fact.pointerChecks.push({ control: 'reset', chain: await clickAuthored(page, lab, '#reset') });
      await expect(lab.locator('#angle')).toHaveValue('0');
      await expect(lab.locator('#angleOut')).toHaveText('0°');
      await expect(lab.locator('#phaseName')).toHaveText('新月');
      await expect(lab.locator('#fraction')).toHaveText('0%');
      await expect(lab.locator('#feedback')).toHaveClass('feedback');
      await expect(lab.locator('#feedback')).toHaveText('选择“正确”或“错误”，检验你的理解。');
      assert.deepEqual(errors, []); assert.deepEqual(network, []);
      if (width !== 390) {
        assert.ok(fact.outerGeometry.scrollWidth <= width + 1, 'Desktop outer horizontal overflow');
        assert.ok(fact.labGeometry.scrollWidth <= fact.labGeometry.width + 1, 'Desktop lab horizontal overflow');
        assert.ok(fact.labGeometry.scrollHeight <= fact.labGeometry.height + 1, 'Desktop lab vertical clipping');
      }
      fact.passed = true; fact.phase = 'complete';
    } catch (error) {
      fact.error = String(error); fact.stack = error.stack;
      await page.screenshot({ path: path.join(out, `failure-${width}.png`), fullPage: true }).catch(() => {});
    } finally {
      facts.push(fact);
      await fs.writeFile(path.join(out, `viewport-${width}.json`), JSON.stringify(fact, null, 2));
      await context.close();
    }
  }
  assert.equal(hash(await fs.readFile(source)), beforeHash, 'The delivered HTML remains unchanged');
  const failures = facts.filter(fact => fact.mode === 'desktop-acceptance' && !fact.passed);
  const result = { status: failures.length ? 'desktop-behavior-failed' : 'desktop-behavior-passed-mobile-observed',
    checkedAt: new Date().toISOString(), source, sha256: beforeHash, originalsUnchanged: true, visualReview: 'pending',
    out, facts, desktopFailures: failures.map(fact => ({ width: fact.width, phase: fact.phase, error: fact.error })) };
  await fs.writeFile(path.join(out, 'result.json'), JSON.stringify(result, null, 2));
  await fs.writeFile(path.join(base, 'latest.json'), JSON.stringify({ out, result: path.join(out, 'result.json') }, null, 2));
  console.log(JSON.stringify({ status: result.status, out, desktopFailures: result.desktopFailures,
    observations: facts.map(fact => ({ width: fact.width, passed: fact.passed, phase: fact.phase })) }));
  if (failures.length) process.exitCode = 1;
} finally { await browser.close(); }
