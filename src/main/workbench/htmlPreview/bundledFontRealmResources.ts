import { readFileSync, realpathSync } from 'node:fs'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import { BUNDLED_FONT_FAMILIES } from '../../../shared/fonts/bundledFontFamilies'
import { resolveBundledFontDescriptors } from '../../../shared/fonts/bundledFontSources'
import type { BundledFontOutputManifest } from '../../../shared/fonts/bundledFontOutputManifest'

export interface BundledFontRealmFile { root: string; path: string }
const contained = (root: string, file: string) => { const relative = path.relative(root, file); return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative) }

/** Only application-bundled fonts can be mapped into a component's existing lease. */
export class BundledFontRealmResources {
  private readonly files = new Map<string, { file: string; root: string; path: string }>()
  constructor(options: { rendererDirectory: string; dependencyDirectory: string; developmentOrigin?: string }) {
    try {
      if (options.developmentOrigin) {
        const origin = new URL(options.developmentOrigin)
        if (origin.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(origin.hostname)) return
        for (const family of resolveBundledFontDescriptors(options.dependencyDirectory)) for (const face of family.faces) {
          const file = path.resolve(options.dependencyDirectory, face.specifier), root = realpathSync(path.dirname(file)), actual = realpathSync(file)
          if (!contained(root, actual)) continue
          const url = new URL(`/@fs/${actual.replaceAll('\\', '/')}`, origin).href
          this.files.set(url, { file: face.file, root, path: actual })
          // Dependencies within the Vite project can also use its ordinary node_modules path.
          this.files.set(new URL(`/node_modules/${face.specifier}`, origin).href, { file: face.file, root, path: actual })
        }
      } else {
        const root = realpathSync(options.rendererDirectory)
        const manifest = JSON.parse(readFileSync(path.join(root, 'bundled-font-manifest.json'), 'utf8')) as BundledFontOutputManifest
        if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.families)) return
        for (const family of manifest.families) {
          if (!BUNDLED_FONT_FAMILIES.includes(family.family)) continue
          for (const face of family.faces) {
            if (path.basename(face.file) !== face.file || !face.file.endsWith('.woff2') || !face.path.startsWith('assets/') || !face.path.endsWith('.woff2')) continue
            const actual = realpathSync(path.resolve(root, face.path))
            if (!contained(path.join(root, 'assets'), actual)) continue
            this.files.set(new URL(face.path, 'courseware-editor://app/').href, { file: face.file, root: path.join(root, 'assets'), path: actual })
          }
        }
      }
    } catch { /* Missing application font resources stay local output diagnostics/fallback. */ }
  }

  project(html: string, urlOf: (file: string) => string): { html: string; files: Map<string, BundledFontRealmFile> } {
    const files = new Map<string, BundledFontRealmFile>()
    html = html.replace(/\/\* guoling-bundled-font-faces:start \*\/[\s\S]*?\/\* guoling-bundled-font-faces:end \*\//g, block => {
      for (const [url, source] of this.files) {
        if (!block.includes(url)) continue
        const name = `bundled-fonts/${source.file}`
        block = block.split(url).join(urlOf(name))
        files.set(name, { root: source.root, path: source.path })
      }
      return block
    })
    return { html, files }
  }

  async read(file: BundledFontRealmFile): Promise<Uint8Array | undefined> {
    try {
      const [root, actual] = await Promise.all([fs.realpath(file.root), fs.realpath(file.path)])
      if (!contained(root, actual)) return undefined
      const bytes = await fs.readFile(actual)
      return bytes.length >= 4 && bytes[0] === 0x77 && bytes[1] === 0x4f && bytes[2] === 0x46 && bytes[3] === 0x32 ? bytes : undefined
    } catch { return undefined }
  }
}
