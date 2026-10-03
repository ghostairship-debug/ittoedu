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

/**
 * Course-wide style sheet (`theme.css`). Hosts inject it, after variables derived
 * from `designTokens`, into every rendered Web document of the course.
 */
export interface CourseTheme {
  css: string
  /**
   * Software-maintained: a project-relative path referenced by `css`
   * (for example `assets/paper.png`) -> the managed asset it resolves to.
   */
  assets?: Record<string, { assetId: string }>
}

/** Portable form used to save a theme as an asset and apply it to another course. */
export interface CourseThemePackage {
  format: 'guoling-course-theme'
  version: 1
  name: string
  designTokens: ProjectDesignTokens
  css: string
}
