export interface ProjectFontToken {
  id: string
  label: string
  fontFamily: string
}

export interface ProjectColorToken {
  id: string
  label: string
  color: string
}

/** Minimal machine-readable style vocabulary; it does not store art-direction prose. */
export interface ProjectDesignTokens {
  fonts: ProjectFontToken[]
  colors: ProjectColorToken[]
}
