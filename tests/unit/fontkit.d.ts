/**
 * Minimal typing for the untyped `fontkit` devDependency.
 *
 * Only the glyph-coverage surface the bundled-font regression gate needs is
 * declared, so a wrong assumption fails to compile instead of passing as `any`.
 */
declare module 'fontkit' {
  interface FontkitFont {
    readonly familyName: string
    readonly numGlyphs: number
    hasGlyphForCodePoint(codePoint: number): boolean
  }

  export function create(buffer: Uint8Array): FontkitFont
}
