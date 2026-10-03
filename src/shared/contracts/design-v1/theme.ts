import { resolveCssAssetReferences } from '../../composition/projectReferences'
import type { CourseTheme, CourseThemePackage, ProjectDesignTokens } from './types'

/** Cascade layer for course-wide styles: a page's own unlayered styles always win. */
export const COURSE_THEME_LAYER = 'guoling-theme'

function tokenName(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, '-')
}

function declarationValue(value: string): string {
  return value.replace(/[{};]/g, '')
}

/** `designTokens` as CSS variables: `--font-<id>` and `--color-<id>` (dots become dashes). */
export function courseThemeVariables(tokens: ProjectDesignTokens): Record<string, string> {
  const variables: Record<string, string> = {}
  for (const font of tokens.fonts) variables[`--font-${tokenName(font.id)}`] = declarationValue(font.fontFamily)
  for (const color of tokens.colors) variables[`--color-${tokenName(color.id)}`] = color.color
  return variables
}

/** Theme CSS with its bound asset slots resolved for the current host. */
export function resolveCourseThemeCss(
  theme: CourseTheme | undefined,
  resolveAsset: (assetId: string) => string | undefined,
): string {
  return theme ? resolveCssAssetReferences(theme.css, theme.assets, resolveAsset) : ''
}

/** One style text for every rendered Web document of the course. */
export function courseThemeStyleText(
  course: { readonly designTokens: ProjectDesignTokens; readonly theme?: CourseTheme },
  resolveAsset: (assetId: string) => string | undefined = () => undefined,
): string {
  const variables = Object.entries(courseThemeVariables(course.designTokens))
    .map(([name, value]) => `${name}:${value};`).join('')
  const css = resolveCourseThemeCss(course.theme, resolveAsset)
  return `@layer ${COURSE_THEME_LAYER}{:root{${variables}}\n${css}\n}`
}

export function createCourseThemePackage(
  course: { readonly designTokens: ProjectDesignTokens; readonly theme?: CourseTheme },
  name: string,
): CourseThemePackage {
  return {
    format: 'guoling-course-theme', version: 1, name,
    designTokens: structuredClone(course.designTokens),
    css: course.theme?.css ?? '',
  }
}

/** Applies a saved theme; asset slots are bound again against the target course on commit. */
export function applyCourseThemePackage<T extends { designTokens: ProjectDesignTokens; theme?: CourseTheme }>(
  course: T,
  theme: CourseThemePackage,
): T {
  const next = structuredClone(course)
  next.designTokens = structuredClone(theme.designTokens)
  if (theme.css) next.theme = { css: theme.css }
  else delete next.theme
  return next
}
