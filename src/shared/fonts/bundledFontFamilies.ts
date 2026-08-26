/**
 * Identity of the fonts shipped inside the application and, later, inside the
 * export templates. These names are authored by us in our own `@font-face`
 * rules and are the only names any surface may rely on.
 *
 * They deliberately do not come from the font binaries: the variable Noto file
 * reports `Noto Sans SC Thin` as its internal family name (the naming of its
 * default instance), so trusting the binary would produce a family nobody
 * selects. Only the `@font-face` descriptor decides the family name.
 *
 * This module has no imports on purpose: the Player runtime depends on it and
 * must stay free of any font asset bytes.
 */

/** Text family for slide/flow copy. */
export const BUNDLED_TEXT_FONT_FAMILY = 'Noto Sans SC'

/** Math family for formula rendering. */
export const BUNDLED_MATH_FONT_FAMILY = 'STIX Two Math'

/**
 * The `font-weight` descriptor of the variable text family. Declaring the whole
 * axis lets the browser instantiate 400/500/700 on demand from one file set
 * instead of shipping nine static weights.
 */
export const BUNDLED_TEXT_FONT_WEIGHT_RANGE = '100 900'

/** The `font-weight` descriptor of the single-weight math family. */
export const BUNDLED_MATH_FONT_WEIGHT = '400'

/** Every family our own `@font-face` rules declare. */
export const BUNDLED_FONT_FAMILIES: readonly string[] = [
  BUNDLED_TEXT_FONT_FAMILY,
  BUNDLED_MATH_FONT_FAMILY,
]
