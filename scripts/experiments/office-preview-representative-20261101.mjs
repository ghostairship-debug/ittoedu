import { promises as fs } from 'node:fs';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

const run = promisify(execFile), require = createRequire(import.meta.url);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const evidenceRoot = path.resolve(process.env.OFFICE_TEST_OUTPUT_DIRECTORY || 'output/comprehensive-execution-20261101/office/resume-20261101');
await fs.mkdir(evidenceRoot, { recursive: true });
const out = await fs.mkdtemp(path.join(evidenceRoot, 'representative-'));
const inputs = path.join(out, 'inputs'), pdfs = path.join(out, 'pdfs');
await fs.mkdir(inputs); await fs.mkdir(pdfs);
const cases = [
  { id: 'representative', file: 'output/component-platform-l23a/representative.pptx' },
  { id: 'mixed-media', file: 'output/audit-real-machine-20261011/post-fix-consumer/workspace/exports/acceptance-mixed-media.pptx' },
  { id: 'equations', file: 'output/playwright/r18-equations/edited.pptx' },
  { id: 'charts', file: 'output/playwright/r17-charts/edited.pptx' },
];
const result = {
  startedAt: new Date().toISOString(), status: 'running', outputDirectory: out,
  boundary: 'Existing representative originals, first and last pages only. Static rendering and PDF reopen are separate from visual review, media/animation playback and original-file editing.',
  visualReview: 'required', files: [], failures: [], originalsUnchanged: false,
};
let browser, server;

const browserSource = `
import { parse, slideText } from '@web-ppt/core';
import { Viewer } from '@web-ppt/viewer-core';
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist/build/pdf.mjs';
GlobalWorkerOptions.workerSrc = '/pdf.worker.mjs';
const bytes = base64 => Uint8Array.from(atob(base64), char => char.charCodeAt(0));
let pres, viewer, pdf, pdfTask;
const elements = slide => {
  const counts = {}, unsupported = [], fonts = new Set();
  const walk = value => {
    if (!value || typeof value !== 'object') return;
    if (value.kind) counts[value.kind] = (counts[value.kind] || 0) + 1;
    if (value.kind === 'unsupported') unsupported.push(value.label);
    if (Array.isArray(value.fonts)) for (const font of value.fonts) fonts.add(font);
    for (const child of Object.values(value)) if (child && typeof child === 'object') walk(child);
  };
  walk(slide); return { counts, unsupported, fonts: [...fonts] };
};
window.officeComparison = {
  async open(input) {
    viewer?.destroy(); pres?.dispose?.(); if (pdfTask) await pdfTask.destroy();
    document.querySelector('h1').textContent = input.name;
    pres = await parse(bytes(input.pptx), { embeddedFonts: 'source' });
    const container = document.querySelector('#pptx');
    container.style.width = '600px'; container.style.height = (600 * pres.height / pres.width) + 'px';
    viewer = new Viewer(container, pres, { animate: false, autoAdvance: false, media: 'badge' });
    viewer.onLinkClick = () => true;
    pdfTask = getDocument({ data: bytes(input.pdf), useSystemFonts: true });
    pdf = await pdfTask.promise;
    return { source: pres.source, slides: pres.slides.length, pdfPages: pdf.numPages, width: pres.width, height: pres.height };
  },
  async page(index) {
    viewer.goTo(index); viewer.setZoom(600 / pres.width);
    const source = await pdf.getPage(index + 1), initial = source.getViewport({ scale: 1 });
    const viewport = source.getViewport({ scale: 600 / initial.width });
    const canvas = document.querySelector('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
    await source.render({ canvas, viewport }).promise;
    await document.fonts.ready;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const svg = document.querySelector('#pptx svg'), bounds = svg?.getBoundingClientRect();
    if (!bounds || !(bounds.width > 0) || !(bounds.height > 0)) throw Error('Web-PPT produced no visible SVG bounds');
    const canvasBounds = canvas.getBoundingClientRect();
    if (!(canvasBounds.width > 0) || !(canvasBounds.height > 0)) throw Error('PDF produced no visible canvas bounds');
    document.querySelector('#page').textContent = '第 ' + (index + 1) + ' / ' + pres.slides.length + ' 页 · 静态终态';
    const content = await source.getTextContent();
    return { index, svgBounds: { width: bounds.width, height: bounds.height }, pdfCanvasBounds: { width: canvasBounds.width, height: canvasBounds.height },
      webPptText: slideText(pres.slides[index]), pdfText: content.items.map(item => 'str' in item ? item.str : '').join(' '), ...elements(pres.slides[index]) };
  },
};
`;
const html = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>Office representative comparison</title>
<style>*{box-sizing:border-box}body{margin:0;background:#f3f5f8;color:#172333;font:14px Arial,'Microsoft YaHei',sans-serif;padding:20px}h1{font-size:20px;margin:0 0 8px}p{margin:0 0 16px;color:#5b6576}.columns{display:grid;grid-template-columns:600px 600px;gap:20px}h2{font-size:15px;margin:0 0 10px}.frame{width:600px;min-height:340px;background:white;box-shadow:0 1px 5px #0002;overflow:hidden}#pptx{position:relative}canvas,svg{display:block}</style>
<h1>载入中</h1><p id="page"></p><div class="columns"><section><h2>Web-PPT 0.5.0 · 只读预览</h2><div class="frame"><div id="pptx"></div></div></section><section><h2>LibreOffice 独立转换 · PDF.js 显示</h2><div class="frame"><canvas></canvas></div></section></div><script src="/browser.js"></script></html>`;

try {
  result.repositoryHead = (await run('git', ['rev-parse', 'HEAD'])).stdout.trim();
  result.packages = Object.fromEntries(await Promise.all(['@web-ppt/core', '@web-ppt/viewer-core', 'pdfjs-dist', 'pdf-lib'].map(async name => {
    let directory = path.dirname(fileURLToPath(import.meta.resolve(name)));
    for (;;) {
      try {
        const metadata = JSON.parse(await fs.readFile(path.join(directory, 'package.json'), 'utf8'));
        if (metadata.name === name) return [name, { version: metadata.version, license: metadata.license }];
      } catch {}
      const parent = path.dirname(directory); if (parent === directory) throw Error('Package metadata missing: ' + name); directory = parent;
    }
  })));
  for (const item of cases) {
    const bytes = await fs.readFile(path.resolve(item.file));
    item.before = hash(bytes);
    item.copy = path.join(inputs, item.id + '.pptx');
    await fs.writeFile(item.copy, bytes, { flag: 'wx' });
    if (hash(await fs.readFile(item.copy)) !== item.before) throw Error(item.id + ' copy hash mismatch');
  }
  const executable = process.env.OFFICE_TEST_SOFFICE || 'C:\\Program Files\\LibreOffice\\program\\soffice.com';
  const profile = '-env:UserInstallation=' + pathToFileURL(path.join(out, 'isolated-profile')).href;
  result.libreOfficeVersion = (await run(executable, [profile, '--version'], { windowsHide: true, timeout: 15000 })).stdout.trim();
  const converted = await run(executable, [profile, '--headless', '--convert-to', 'pdf', '--outdir', pdfs,
    ...cases.map(item => item.copy)], { windowsHide: true, timeout: 120000 });
  result.conversion = { stdout: converted.stdout, stderr: converted.stderr };
  await build({ stdin: { contents: browserSource, sourcefile: 'office-comparison.ts', resolveDir: process.cwd(), loader: 'ts' },
    bundle: true, platform: 'browser', format: 'iife', outfile: path.join(out, 'browser.js'), logLevel: 'warning' });
  const bundle = await fs.readFile(path.join(out, 'browser.js'));
  const pdfWorker = await fs.readFile(require.resolve('pdfjs-dist/build/pdf.worker.mjs'));
  server = createServer((request, response) => {
    const pathname = new URL(request.url || '/', 'http://127.0.0.1').pathname;
    if (pathname === '/') { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(html); }
    else if (pathname === '/browser.js' || pathname === '/pdf.worker.mjs') { response.setHeader('Content-Type', 'text/javascript'); response.end(pathname === '/browser.js' ? bundle : pdfWorker); }
    else { response.statusCode = 404; response.end(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = 'http://127.0.0.1:' + server.address().port;
  const executablePath = process.env.OFFICE_TEST_BROWSER || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
  browser = await chromium.launch({ executablePath, headless: true });
  result.browser = { executablePath, version: browser.version() };
  for (const item of cases) {
    const fileResult = { id: item.id, source: path.resolve(item.file), sourceSha256: item.before, status: 'running', pages: [], pageErrors: [], consoleWarnings: [], externalRequests: [] };
    result.files.push(fileResult);
    const page = await browser.newPage({ viewport: { width: 1260, height: 900 }, deviceScaleFactor: 1 });
    page.on('pageerror', error => fileResult.pageErrors.push(String(error)));
    page.on('console', message => { if (message.type() === 'warning' || message.type() === 'error') fileResult.consoleWarnings.push(message.text()); });
    await page.route('**/*', route => {
      const url = route.request().url();
      if (url.startsWith(origin + '/') || /^(?:blob:|data:)/.test(url)) return route.continue();
      fileResult.externalRequests.push(url); return route.abort();
    });
    try {
      const pdfPath = path.join(pdfs, item.id + '.pdf'), pdfBytes = await fs.readFile(pdfPath);
      if (!pdfBytes.length || pdfBytes.subarray(0, 5).toString('ascii') !== '%PDF-') throw Error('Missing or invalid PDF output');
      const pdf = await PDFDocument.load(pdfBytes);
      fileResult.pdf = { path: pdfPath, bytes: pdfBytes.length, sha256: hash(pdfBytes), pages: pdf.getPageCount() };
      const pptxBytes = await fs.readFile(item.copy);
      if (hash(pptxBytes) !== item.before) throw Error('The isolated input changed during conversion');
      await page.goto(origin); await page.waitForFunction(() => Boolean(window.officeComparison), undefined, { timeout: 30000 });
      const opened = await page.evaluate(input => window.officeComparison.open(input), {
        name: item.file, pptx: pptxBytes.toString('base64'), pdf: pdfBytes.toString('base64'),
      });
      fileResult.opened = opened;
      fileResult.pageCountAgreement = opened.slides === opened.pdfPages && opened.pdfPages === pdf.getPageCount();
      if (!fileResult.pageCountAgreement) throw Error('PPTX and independent PDF page counts disagree');
      for (const index of [...new Set([0, opened.slides - 1])]) {
        const evidence = await page.evaluate(index => window.officeComparison.page(index), index);
        const screenshot = path.join(out, `${item.id}-page-${index + 1}.png`);
        await page.screenshot({ path: screenshot, fullPage: true });
        const text = value => value.normalize('NFKC').replace(/[\s\u200b]/g, '');
        fileResult.pages.push({ ...evidence, screenshot, exactNormalizedTextMatch: text(evidence.webPptText) === text(evidence.pdfText), visualReview: 'required' });
      }
      fileResult.status = fileResult.pageErrors.length ? 'failed' : 'rendered-for-review';
      if (fileResult.pageErrors.length) result.failures.push(item.id + ': browser page errors');
      if (hash(await fs.readFile(pdfPath)) !== fileResult.pdf.sha256) throw Error('PDF bytes changed during evidence capture');
    } catch (error) {
      fileResult.status = 'failed'; fileResult.error = String(error); result.failures.push(item.id + ': ' + String(error));
    } finally { await page.close(); }
  }
  result.status = result.failures.length ? 'completed-with-failures' : 'completed-with-review-required';
} catch (error) {
  result.status = 'failed'; result.failures.push(String(error));
  if (error?.stdout) result.stdout = error.stdout;
  if (error?.stderr) result.stderr = error.stderr;
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  const sourceChecks = await Promise.all(cases.map(async item => {
    try { return { id: item.id, unchanged: Boolean(item.before) && hash(await fs.readFile(path.resolve(item.file))) === item.before }; }
    catch (error) { return { id: item.id, unchanged: false, error: String(error) }; }
  }));
  result.sourceChecks = sourceChecks; result.originalsUnchanged = sourceChecks.every(item => item.unchanged);
  if (!result.originalsUnchanged) { result.status = 'failed'; result.failures.push('An original could not be verified unchanged'); }
}
result.finishedAt = new Date().toISOString();
await fs.writeFile(path.join(out, 'result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
if (result.failures.length) process.exitCode = 1;
