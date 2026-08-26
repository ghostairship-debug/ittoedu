import type { ExportPayload } from '../../shared/componentTypes'
import type { PublishedLessonPayload } from '../../shared/publishedLessonTypes'
import { jsonToBase64 } from './base64'
import {
  bundledFontDataUrlCss,
  bundledFontNoticeHtmlComment,
  resolveEmbeddedBundledFonts,
  withBundledFontCss,
} from './bundledFontEmbedding'
import {
  buildPublishedLessonPayload,
  isPublishedLessonPayload,
} from './buildPublishedLesson'

export interface StandaloneHtmlOptions {
  playerBundle: string
  lang?: string
}

const PLAYER_STYLES = `
:root {
  color-scheme: dark;
  font-family: Inter, "Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif;
  background: #111318;
}

* {
  box-sizing: border-box;
}

html,
body,
#lesson-root {
  width: 100%;
  height: 100%;
  margin: 0;
  overflow: hidden;
}

body {
  background: #111318;
}

.lesson-shell {
  display: flex;
  width: 100%;
  height: 100%;
  min-width: 280px;
  min-height: 180px;
  flex-direction: column;
  background: #111318;
}

.lesson-stage {
  position: relative;
  display: flex;
  min-width: 0;
  min-height: 0;
  flex: 1 1 auto;
  align-items: center;
  justify-content: center;
  overflow: hidden;
}

.lesson-canvas-host {
  width: 100%;
  height: 100%;
}

.lesson-canvas-host canvas {
  display: block;
}

.lesson-player-error {
  display: grid;
  width: 100%;
  height: 100%;
  place-items: center;
  padding: 32px;
  color: #fecaca;
  background: #1b1114;
  font: 16px/1.6 Inter, "Microsoft YaHei", sans-serif;
  text-align: center;
}

`.trim()

function escapeHtmlText(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function escapeScriptContents(value: string): string {
  return value
    .replace(/<\/script/gi, '<\\/script')
    .replace(/<!--/g, '\\x3C!--')
    // Phaser contains informational URL strings (for example its banner and
    // DOM namespace constants). Keep their runtime value while ensuring the
    // exported source itself has no literal remote URL.
    .replaceAll('https://', 'https:\\x2F\\x2F')
    .replaceAll('http://', 'http:\\x2F\\x2F')
}

function normalizeOptions(
  playerBundleOrOptions: string | StandaloneHtmlOptions,
): Required<StandaloneHtmlOptions> {
  if (typeof playerBundleOrOptions === 'string') {
    return {
      playerBundle: playerBundleOrOptions,
      lang: 'zh-CN',
    }
  }

  return {
    playerBundle: playerBundleOrOptions.playerBundle,
    lang: playerBundleOrOptions.lang ?? 'zh-CN',
  }
}

export function buildStandaloneHtml(
  payload: ExportPayload | PublishedLessonPayload,
  playerBundle: string,
): string
export function buildStandaloneHtml(
  payload: ExportPayload | PublishedLessonPayload,
  options: StandaloneHtmlOptions,
): string
export function buildStandaloneHtml(
  payload: ExportPayload | PublishedLessonPayload,
  playerBundleOrOptions: string | StandaloneHtmlOptions,
): string {
  const { playerBundle, lang } = normalizeOptions(playerBundleOrOptions)
  if (!playerBundle.trim()) {
    throw new Error('Player Runtime 为空，无法生成独立 HTML')
  }
  const published = isPublishedLessonPayload(payload)
    ? payload
    : buildPublishedLessonPayload(payload)

  const encodedPayload = jsonToBase64(published)
  const payloadAssignment = escapeScriptContents(
    `window.__H5_LESSON_PAYLOAD__=${JSON.stringify(encodedPayload)};`,
  )
  const safePlayerBundle = escapeScriptContents(playerBundle)
  // Only the bundled families this lesson declares, carried as `data:` URIs so
  // the file stays offline-portable. `font-src data:` is already in the CSP.
  const fonts = resolveEmbeddedBundledFonts(published)
  const styles = withBundledFontCss(PLAYER_STYLES, bundledFontDataUrlCss(fonts))

  return `<!doctype html>
<html lang="${escapeHtmlText(lang)}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self' blob: 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:; connect-src data: blob:; worker-src blob:">
  <title>${escapeHtmlText(published.title)}</title>
  <style>${styles}</style>${bundledFontNoticeHtmlComment(fonts)}
</head>
<body>
  <div id="lesson-root" aria-label="${escapeHtmlText(published.title)}"></div>
  <script>${payloadAssignment}</script>
  <script>${safePlayerBundle}</script>
</body>
</html>
`
}
