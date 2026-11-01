import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';

const run = promisify(execFile);
const base = path.resolve(process.env.OFFICE_TEST_FIXTURE_DIRECTORY || 'output/comprehensive-execution-20261101/office/fixtures');
const evidenceRoot = path.resolve(process.env.OFFICE_TEST_OUTPUT_DIRECTORY || 'output/comprehensive-execution-20261101/office/resume-20261101');
await fs.mkdir(evidenceRoot, { recursive: true });
// A fresh directory prevents an old successful conversion from satisfying a new run.
const out = await fs.mkdtemp(path.join(evidenceRoot, 'candidate-independent-'));
const files = ['web-ppt-edited.pptx', 'web-ppt-browser-edited.pptx'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const before = {};
const result = {
  startedAt: new Date().toISOString(), status: 'running', engine: 'LibreOffice',
  outputDirectory: out, files: [], originalsUnchanged: false,
  boundary: 'Independent static PDF reopen of the two edited candidate fixtures; not a visual fidelity or animation compatibility claim.',
};

try {
  for (const name of files) before[name] = hash(await fs.readFile(path.join(base, name)));
  const executable = process.env.OFFICE_TEST_SOFFICE || 'C:\\Program Files\\LibreOffice\\program\\soffice.com';
  const profile = '-env:UserInstallation=' + pathToFileURL(path.join(out, 'isolated-profile')).href;
  const version = await run(executable, [profile, '--version'], { windowsHide: true, timeout: 15000 });
  result.engineVersion = version.stdout.trim();
  const conversion = await run(executable, [profile, '--headless', '--convert-to', 'pdf', '--outdir', out,
    ...files.map(name => path.join(base, name))], { windowsHide: true, timeout: 60000 });
  result.stdout = conversion.stdout;
  result.stderr = conversion.stderr;
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');

  for (const name of files) {
    const pdfPath = path.join(out, name.replace(/\.pptx$/, '.pdf'));
    const bytes = await fs.readFile(pdfPath);
    if (bytes.length === 0 || bytes.subarray(0, 5).toString('ascii') !== '%PDF-') throw Error(name + ' missing or empty PDF payload');
    // pdf.js may transfer (detach) its input ArrayBuffer to a worker. Fingerprint the
    // original file before parsing and give pdf.js its own copy, never the evidence bytes.
    const pdfSha256 = hash(bytes);
    const parsed = await PDFDocument.load(bytes);
    const pages = parsed.getPageCount();
    if (pages !== 2) throw Error(name + ' unexpected PDF page count: ' + pages);
    const pdfJsInput = Uint8Array.from(bytes);
    const task = getDocument({ data: pdfJsInput, disableFontFace: true, useSystemFonts: true });
    const text = [];
    try {
      const reader = await task.promise;
      if (reader.numPages !== pages) throw Error(name + ' independent PDF parsers disagree on page count');
      for (let index = 1; index <= reader.numPages; index++) {
        const content = await (await reader.getPage(index)).getTextContent();
        text.push(content.items.map(item => 'str' in item ? item.str : '').join(' '));
      }
    } finally {
      await task.destroy();
    }
    const expected = name.includes('browser') ? 'Browser changed second' : 'Changed second';
    if (!text[0].includes(expected)) throw Error(name + ' expected edited text absent: ' + text[0]);
    if (!text[1].includes('Keep other slide')) throw Error(name + ' unchanged slide text absent: ' + text[1]);
    const reread = await fs.readFile(pdfPath);
    if (reread.length !== bytes.length || hash(reread) !== pdfSha256 || hash(bytes) !== pdfSha256) {
      throw Error(name + ' PDF bytes changed while collecting evidence');
    }
    result.files.push({
      name, sourceSha256: before[name], pdf: pdfPath, pdfBytes: bytes.length,
      pdfHeader: bytes.subarray(0, 8).toString('ascii'), pdfSha256, pages, text,
      pdfJsInputBytesAfterParsing: pdfJsInput.byteLength, diskHashRechecked: true,
    });
  }
  result.status = 'passed';
} catch (error) {
  result.status = 'failed';
  result.error = String(error);
  if (error?.stdout) result.stdout = error.stdout;
  if (error?.stderr) result.stderr = error.stderr;
  process.exitCode = 1;
} finally {
  try {
    result.originalsUnchanged = Object.keys(before).length === files.length
      && (await Promise.all(files.map(async name => hash(await fs.readFile(path.join(base, name))) === before[name]))).every(Boolean);
  } catch (error) {
    result.sourceRecheckError = String(error);
  }
  if (!result.originalsUnchanged) {
    result.status = 'failed';
    result.error ??= 'Candidate source file changed or could not be rechecked';
    process.exitCode = 1;
  }
}

result.finishedAt = new Date().toISOString();
await fs.writeFile(path.join(out, 'result.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
