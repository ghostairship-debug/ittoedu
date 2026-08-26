/**
 * Declarative description of the bundled fonts, plus the pure assembly step
 * that binds build-time URLs onto it.
 *
 * The descriptor half is plain data resolved from the upstream packages at
 * build time (see `bundledFontSources.ts`). The URL half only exists once a
 * bundler has emitted the `woff2` files, so the two are joined here instead of
 * being hard-coded. Keeping the join pure keeps it testable without Vite.
 */

/** Verbatim license record carried alongside every bundled family. */
export interface BundledFontLicense {
  /** SPDX identifier, e.g. `OFL-1.1`. */
  readonly type: string
  /** Copyright holder line required by the license. */
  readonly attribution: string
  /** Repository-relative path of the verbatim license copy. */
  readonly noticePath: string
  /** Upstream package the binaries were copied from. */
  readonly packageName: string
  /** Upstream package version, so a font upgrade is visible in diffs. */
  readonly packageVersion: string
}

/** One `woff2` file, before a bundler has given it a URL. */
export interface BundledFontFaceDescriptor {
  /** File name inside the upstream package; the stable identity of the face. */
  readonly file: string
  /** Bare import specifier the build turns into a URL. */
  readonly specifier: string
  /**
   * Present only for the sliced text family, where the ranges are the intended
   * lazy-loading mechanism. Absent means "this face answers for every code
   * point it has a glyph for", which is what the math family requires.
   */
  readonly unicodeRange?: string
}

/** One family, before a bundler has given its files URLs. */
export interface BundledFontFamilyDescriptor {
  readonly family: string
  readonly style: 'normal'
  /** CSS `font-weight` descriptor; a range for variable families. */
  readonly weight: string
  /** CSS `font-display` descriptor. */
  readonly display: string
  readonly license: BundledFontLicense
  readonly faces: readonly BundledFontFaceDescriptor[]
}

/** A face with its emitted URL resolved. */
export interface BundledFontFace extends BundledFontFaceDescriptor {
  /** URL produced by the bundler (an emitted asset or an inlined data URI). */
  readonly url: string
}

/** A family with every face URL resolved. */
export interface BundledFontFamily extends Omit<BundledFontFamilyDescriptor, 'faces'> {
  readonly faces: readonly BundledFontFace[]
}

/** The runtime-ready manifest consumed by the `@font-face` generator. */
export interface BundledFontManifest {
  readonly families: readonly BundledFontFamily[]
}

/**
 * Bind `urls` onto `descriptors` in declaration order.
 *
 * The build emits one `?url` import per face in exactly this order, so a
 * mismatch means the generated module and the descriptors drifted apart. That
 * has to fail loudly: a silently shifted URL would point a slice at another
 * slice's glyphs.
 */
export function assembleBundledFontManifest(
  descriptors: readonly BundledFontFamilyDescriptor[],
  urls: readonly string[],
): BundledFontManifest {
  let cursor = 0
  const families = descriptors.map((descriptor): BundledFontFamily => ({
    ...descriptor,
    faces: descriptor.faces.map((face): BundledFontFace => {
      const url = urls[cursor]
      cursor += 1
      if (typeof url !== 'string' || !url) {
        throw new Error(`内置字体缺少构建产物 URL：${face.specifier}`)
      }
      return { ...face, url }
    }),
  }))
  if (cursor !== urls.length) {
    throw new Error(
      `内置字体 URL 数量与清单不一致：清单 ${cursor} 个，构建产物 ${urls.length} 个`,
    )
  }
  return { families }
}

/** Total number of faces the manifest declares. */
export function countBundledFontFaces(manifest: BundledFontManifest): number {
  return manifest.families.reduce((total, family) => total + family.faces.length, 0)
}
