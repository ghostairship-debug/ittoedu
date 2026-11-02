import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { chromium } from '@playwright/test';
const run = promisify(execFile), source = path.resolve(process.argv[2]);
const parent = path.resolve('output/goal-correction-20261102/pptx-independent');
await fs.mkdir(parent, { recursive: true });
const out = await fs.mkdtemp(path.join(parent, 'run-'));
const sha = b => createHash('sha256').update(b).digest('hex');
const before = sha(await fs.readFile(source));
const expectedSecondTitle = process.argv[3] ?? '未编辑的第二页';
if (process.argv[4] && before !== process.argv[4]) throw Error('Independent source does not match the accepted original hash');
const result = { startedAt: new Date().toISOString(), source, output: out, before,
  boundary: 'Independent LibreOffice native OOXML load and static PDF rendering. Does not assert PowerPoint-specific animation/media playback.' };
let browser;
try {
  const exe = 'C:/Program Files/LibreOffice/program/soffice.com';
  const profile = '-env:UserInstallation=' + pathToFileURL(path.join(out, 'profile')).href;
  result.engine = (await run(exe, [profile, '--version'], { windowsHide:true, timeout:15000 })).stdout.trim();
  const converted = await run(exe, [profile, '--headless', '--convert-to', 'pdf', '--outdir', out, source], { windowsHide:true, timeout:90000 });
  result.conversion = { stdout:converted.stdout, stderr:converted.stderr };
  const pdf = path.join(out, path.basename(source, '.pptx')+'.pdf'), bytes = await fs.readFile(pdf);
  if (bytes.subarray(0,5).toString() !== '%PDF-') throw Error('No independent PDF');
  result.pdfSha256 = sha(bytes); result.pdf = pdf;
  const {getDocument} = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const task = getDocument({ data:Uint8Array.from(bytes), useSystemFonts:true });
  const doc = await task.promise; result.pages = doc.numPages; result.text = [];
  for (let i=1;i<=doc.numPages;i++) result.text.push((await (await doc.getPage(i)).getTextContent()).items.map(t=>t.str??'').join(' '));
  await task.destroy();
  const compact = text => text.replace(/\s+/gu, '');
  if (result.pages !== 2 || !compact(result.text[0]).includes('人工修改保留') || !compact(result.text[0]).includes('共同编辑后的值') || !compact(result.text[1]).includes(compact(expectedSecondTitle))) throw Error('Independent application lost expected edited/untouched content');
  browser = await chromium.launch({headless:true});
  const page = await browser.newPage({viewport:{width:1440,height:1000}});
  await page.route('http://office-evidence.local/**',async route=>{
    const p=new URL(route.request().url()).pathname;
    if(p==='/saved.pdf') return route.fulfill({contentType:'application/pdf',body:bytes});
    if(p==='/pdf.mjs'||p==='/pdf.worker.mjs') return route.fulfill({contentType:'text/javascript',body:await fs.readFile(path.resolve('node_modules/pdfjs-dist/build/'+p.slice(1)))});
    return route.fulfill({contentType:'text/html',body:'<!doctype html><html><body style="margin:0;background:#eef1f5"><canvas></canvas><script type="module">import{getDocument,GlobalWorkerOptions}from"/pdf.mjs";GlobalWorkerOptions.workerSrc="/pdf.worker.mjs";window.pdf=await getDocument({url:"/saved.pdf",useSystemFonts:true}).promise;window.render=async n=>{const p=await window.pdf.getPage(n),v=p.getViewport({scale:1.5}),c=document.querySelector("canvas");c.width=v.width;c.height=v.height;await p.render({canvasContext:c.getContext("2d"),viewport:v}).promise;return{width:v.width,height:v.height}};window.loaded=true;</script></body></html>'});
  });
  await page.goto('http://office-evidence.local/');
  await page.waitForFunction(()=>window.loaded);
  result.images=[];
  for(let i=1;i<=result.pages;i++){await page.evaluate(n=>window.render(n),i);const filename=path.join(out,'independent-page-'+i+'.png');await page.locator('canvas').screenshot({path:filename});result.images.push(filename);}
  result.after=sha(await fs.readFile(source));
  if(result.after!==before)throw Error('Independent reopen changed original');
  result.status='passed-static-compatibility-awaiting-visual-review';
} catch(error) { result.status='failed'; result.error=String(error);process.exitCode=1; }
finally {await browser?.close();result.finishedAt=new Date().toISOString();await fs.writeFile(path.join(out,'result.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));}
