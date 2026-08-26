/**
 * The offline assertion has to survive the licence text an offline export ships.
 *
 * Both release verifiers used a whole-file `https?://` search, which a lesson
 * using a bundled family fails on its own OFL notice. The same mistake was
 * already fixed once in `tests/e2e/editor.spec.ts` (`a4dd298`) while these two
 * copies were missed, so the check now has one implementation and this test.
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertNoRemoteUrlReferences } from '../../scripts/releaseArtifactEvidence'

const repoRoot = resolve(__dirname, '..', '..')

describe('assertNoRemoteUrlReferences', () => {
  it('passes a document whose only URLs are inside comments', () => {
    expect(() => assertNoRemoteUrlReferences(
      '<!doctype html><!-- see http://scripts.sil.org/OFL --><p>正文</p>',
      '单 HTML',
    )).not.toThrow()
  })

  it('still rejects a URL the document would actually fetch', () => {
    for (const html of [
      '<script src="https://cdn.example.com/p.js"></script>',
      '<img src="http://example.com/a.png">',
      '<style>@font-face{src:url(https://fonts.example.com/a.woff2)}</style>',
    ]) {
      expect(() => assertNoRemoteUrlReferences(html, '单 HTML'), html).toThrow(/含有远程 URL/u)
    }
  })

  it('names what it found, so a real remote dependency is actionable', () => {
    expect(() => assertNoRemoteUrlReferences(
      '<img src="https://example.com/a.png">',
      '移动后的单 HTML',
    )).toThrow(/https:\/\/example\.com\/a\.png/u)
  })

  it('accepts the real OFL notices this repo redistributes', () => {
    // The vendored licences are what an export embeds verbatim; both carry
    // `http://scripts.sil.org/OFL` and Noto's now carries Adobe's URL too.
    for (const notice of [
      'vendor/fonts/noto-sans-sc/LICENSE',
      'vendor/fonts/stix-two-math/LICENSE',
    ]) {
      const text = readFileSync(join(repoRoot, notice), 'utf8')
      expect(text, notice).toMatch(/https?:\/\//u)
      expect(
        () => assertNoRemoteUrlReferences(`<!doctype html><!--\n${text}\n--><p>正文</p>`, notice),
        notice,
      ).not.toThrow()
    }
  })
})
