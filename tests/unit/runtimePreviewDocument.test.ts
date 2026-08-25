import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { buildRuntimePreviewDocument } from '@/renderer/preview/runtimePreviewDocument'

describe('runtime preview document', () => {
  it('replaces standalone startup scripts with the token-bound bridge', () => {
    const standalone = `<!doctype html>
<html><head><meta http-equiv="Content-Security-Policy" content="connect-src 'none'"></head>
<body>
  <div id="lesson-root"></div>
  <script>window.__H5_LESSON_PAYLOAD__='payload'</script>
  <script type="text/javascript">window.__PLAYER_BUNDLE__=true</script>
</body></html>`

    const document = buildRuntimePreviewDocument(
      standalone,
      'session"><unsafe',
    )

    expect(document).not.toContain("__H5_LESSON_PAYLOAD__='payload'")
    expect(document).not.toContain('__PLAYER_BUNDLE__')
    expect(document).toContain('connect-src \'none\'')
    expect(document).toContain('data-token="session&quot;&gt;&lt;unsafe"')
    expect(document).toContain('courseware-preview-bootstrap:ready')
    expect(document).toContain('courseware-preview-bootstrap:error')
    expect(document).toContain('__H5_LESSON_PLAYER_OPTIONS__')
    expect(document).not.toContain('playerOptions.shellControls')
    expect(document).toContain('materializePayloadAssets')
    expect(document).toContain('URL.createObjectURL')
  })

  it('allows only blob-backed frames in the editor shell CSP', () => {
    const editorHtml = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')

    expect(editorHtml).toContain('frame-src blob:')
    expect(editorHtml).toContain("img-src 'self' blob: data: https:")
    expect(editorHtml).toContain("media-src 'self' blob: data: https:")
    expect(editorHtml).toContain("font-src 'self' data: https:")
    expect(editorHtml).toContain("connect-src 'self' blob: https: wss:")
    expect(editorHtml).not.toMatch(/script-src[^;]*https:/)
    expect(editorHtml).not.toContain("frame-src 'none'")
    const bootstrapSource = readFileSync(resolve(
      process.cwd(),
      'src/renderer/preview/runtimePreviewBootstrap.js',
    ), 'utf8')
    const bootstrapHash = createHash('sha256')
      .update(bootstrapSource, 'utf8')
      .digest('base64')
    expect(editorHtml).toContain(`'sha256-${bootstrapHash}'`)
    expect(editorHtml).not.toContain("script-src 'self' blob: 'unsafe-eval' 'unsafe-inline'")
  })
})
