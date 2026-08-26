/**
 * Node-side byte source for font embedding.
 *
 * BUILD-TIME / NODE ONLY. Importing this module registers itself as the byte
 * source for every later export in the same process, and it reaches
 * `node_modules` and `vendor/` through `node:fs`. It must never be imported by
 * renderer or Player runtime code — the renderer runs sandboxed
 * (`nodeIntegration: false`), and a static `node:fs` import anywhere in its
 * graph fails the browser build outright. `bundledFontExportEmbedding.test.ts`
 * guards that boundary.
 *
 * The one-line side-effect import is the whole wiring cost for a host that does
 * have a filesystem (the courseware build scripts, the test suite).
 */
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveBundledFontDescriptors } from '../../shared/fonts/bundledFontSources'
import {
  registerBundledFontEmbedSource,
  type EmbeddableBundledFont,
} from './bundledFontEmbedding'

/** `src/renderer/export/` is four levels below the repository root. */
const REPOSITORY_ROOT = resolve(fileURLToPath(import.meta.url), '..', '..', '..', '..')
const NODE_MODULES = join(REPOSITORY_ROOT, 'node_modules')

const cache = new Map<string, EmbeddableBundledFont>()

/**
 * Resolve the requested bundled families to bytes plus their license text.
 *
 * Descriptors come from the shared build-time resolver, so file names,
 * `unicode-range` slices and license records stay single-sourced; only the
 * reading of the bytes lives here. Unknown families are ignored rather than
 * rejected: the caller filters against the bundled family list already, and an
 * export must not fail over typography.
 */
export function resolveEmbeddableBundledFonts(
  families: readonly string[],
): EmbeddableBundledFont[] {
  const requested = new Set(families)
  const missing = [...requested].filter((family) => !cache.has(family))
  if (missing.length > 0) {
    for (const descriptor of resolveBundledFontDescriptors(NODE_MODULES)) {
      if (!requested.has(descriptor.family) || cache.has(descriptor.family)) continue
      cache.set(descriptor.family, {
        ...descriptor,
        licenseText: readFileSync(
          join(REPOSITORY_ROOT, descriptor.license.noticePath),
          'utf8',
        ),
        faces: descriptor.faces.map((face) => ({
          ...face,
          bytes: readFileSync(join(NODE_MODULES, face.specifier)),
        })),
      })
    }
  }
  return families
    .map((family) => cache.get(family))
    .filter((font): font is EmbeddableBundledFont => font !== undefined)
}

registerBundledFontEmbedSource(resolveEmbeddableBundledFonts)
