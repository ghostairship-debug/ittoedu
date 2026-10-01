import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(__dirname, '../../..')
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR4nGNQTX6tmvyaAUIBACWKBc28sHaMAAAAAElFTkSuQmCC', 'base64')

export interface M23Fixture {
  directory: string
  workspace: string
  profile: string
  files: { preview: string; securityOne: string; securityTwo: string; lightEdit: string; sibling: string; replacement: string; outsideSecret: string; symlink: string }
  symlinkError?: string
  sources: { lightEdit: string; sibling: string }
}

const securityHtml = (title: string) => `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>${title}</title>
<style>body{font:20px sans-serif;margin:30px}button{margin:8px;padding:8px}</style></head><body>
<main><h1>${title}</h1><p>这是用于检查 HTML 预览隔离的本地页面。</p>
<form id="escape-form" action="https://g20-fixture.invalid/form" method="get" target="_top"><button id="submit-form" type="submit">提交表单</button></form>
<button id="attempt-top" type="button">尝试顶层导航</button><button id="attempt-window" type="button">尝试新窗口</button></main>
<script>
window.__m23SecurityProbe = function () {
  var own = { desktopAPI: typeof window.desktopAPI !== 'undefined', require: typeof window.require !== 'undefined', process: typeof window.process !== 'undefined' };
  var parentApiReadable = false, parentApiValue = 'blocked';
  try { parentApiValue = typeof parent.desktopAPI; parentApiReadable = true; } catch (_) {}
  var otherFrames = 0, crossFrameReads = 0;
  for (var i = 0; i < parent.frames.length; i += 1) {
    var candidate = parent.frames[i];
    if (candidate === window) continue;
    otherFrames += 1;
    try { void candidate.document.documentElement; crossFrameReads += 1; } catch (_) {}
  }
  return { own, parentApiReadable, parentApiValue, parentFrameCount: parent.frames.length, otherFrames, crossFrameReads };
};
window.__m23Actions = {
  top: function () { try { window.top.location.href = 'https://g20-fixture.invalid/top'; return 'assignment-returned'; } catch (error) { return String(error); } },
  popup: function () { try { return window.open('https://g20-fixture.invalid/window', '_blank') ? 'opened' : 'blocked'; } catch (error) { return String(error); } },
  fetch: async function (url) { try { var response = await fetch(url); return { status: response.status, body: await response.text() }; } catch (error) { return { error: String(error) }; } },
  relative: function () { return this.fetch('../secret.txt'); },
  encoded: function () { return this.fetch(location.href.slice(0, location.href.lastIndexOf('/') + 1) + '%252e%252e%252fsecret.txt'); },
  symlink: function () { return this.fetch('./linked-secret.txt'); },
};
document.getElementById('attempt-top').addEventListener('click', function () { window.__m23TopResult = window.__m23Actions.top(); });
document.getElementById('attempt-window').addEventListener('click', function () { window.__m23PopupResult = window.__m23Actions.popup(); });
</script></body></html>`

export function m23Fixture(spec: string): M23Fixture {
  const base = join(root, 'output/g20/m23', spec)
  mkdirSync(base, { recursive: true })
  const directory = mkdtempSync(join(base, 'run-'))
  const workspace = join(directory, 'workspace')
  mkdirSync(workspace)

  const preview = join(workspace, 'three-sections.html')
  const m24Preview = readFileSync(join(root, 'tests/fixtures/g20-m24/three-sections.html'), 'utf8')
  const previewSource = m24Preview.replace('<section id="nested-detail"',
    '<img id="missing-image" alt="未提供图片源" width="150" height="72"><audio id="missing-audio" title="未提供音频源" controls></audio><video id="missing-video" title="未提供视频源" controls width="180" height="96"></video>\n      <section id="nested-detail"')
  if (previewSource === m24Preview) throw new Error('M23 preview fixture insertion point is missing')
  writeFileSync(preview, previewSource, 'utf8')

  const securityOne = join(workspace, 'security-one.html'), securityTwo = join(workspace, 'security-two.html')
  writeFileSync(securityOne, securityHtml('隔离检查页甲'), 'utf8')
  writeFileSync(securityTwo, securityHtml('隔离检查页乙'), 'utf8')
  const outsideSecret = join(directory, 'secret.txt')
  writeFileSync(outsideSecret, 'M23 OUTSIDE WORKSPACE SECRET', 'utf8')
  const symlink = join(workspace, 'linked-secret.txt')
  let symlinkError: string | undefined
  try { symlinkSync(outsideSecret, symlink, 'file') } catch (error) { symlinkError = error instanceof Error ? `${error.name}: ${error.message}` : String(error) }

  const lightEdit = join(workspace, 'light-edit.html')
  const lightEditSource = `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8"><title>M23 轻编辑夹具</title>
<style>body{font:22px sans-serif;margin:32px;color:#17324d}main{max-width:900px;padding:24px;background:#f8fafc}p{padding:8px}.counter{margin-top:24px;padding:12px;background:#dbeafe}img{width:96px;height:96px;object-fit:contain}</style></head>
<body><main id="lesson">
<svg width="40" height="20"><path d="M0 10L40 10" stroke="black"/></svg><template><p>保留模板</p></template><select aria-label="fixture choice"><option>默认</option></select><math><mi>x</mi></math>
<h1 id="lesson-title">可编辑 HTML 课例</h1>
<p id="duplicate-a">同一文案。</p>
<p id="duplicate-b">同一文案。</p>
<p id="special">原始 &amp; 文本：春天</p>
<img id="hero" alt="原始示意图" src="data:image/png;base64,${PNG.toString('base64')}">
<picture id="responsive-picture"><source id="responsive-source" media="(min-width: 600px)" srcset="old-source-small.png 1x, old-source-large.png 2x" sizes="(min-width: 600px) 300px, 100vw"><img id="responsive" alt="需要替换的响应式图片" src="old-image.png" srcset="old-image-2x.png 2x" sizes="300px"></picture>
<div class="counter"><button id="count-up" type="button" data-count="0" onclick="var n=Number(this.dataset.count||0)+1;this.dataset.count=String(n);document.getElementById('count-value').textContent='计数：'+n;">计数 +1</button><output id="count-value">计数：0</output></div>
<div id="script-host"></div>
</main><script>var generated=document.createElement('p');generated.id='script-generated';generated.textContent='脚本生成的文字不能直接编辑';document.getElementById('script-host').append(generated);</script></body></html>
`
  writeFileSync(lightEdit, lightEditSource, 'utf8')

  const sibling = join(workspace, 'sibling.html')
  const siblingSource = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>第二个编辑页</title><style>body{font:24px sans-serif;margin:40px}</style></head><body><main><h1>第二个 HTML 标签</h1><p id="sibling-copy">乙文案。</p></main></body></html>`
  writeFileSync(sibling, siblingSource, 'utf8')
  const replacement = join(workspace, 'replacement.png')
  writeFileSync(replacement, PNG)

  return { directory, workspace, profile: join(directory, 'profile'),
    files: { preview, securityOne, securityTwo, lightEdit, sibling, replacement, outsideSecret, symlink },
    ...(symlinkError ? { symlinkError } : {}), sources: { lightEdit: lightEditSource, sibling: siblingSource } }
}

export const m23ReplacementPng = PNG
