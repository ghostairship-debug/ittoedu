import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(__dirname, '..', '..')

function source(path: string): string {
  return readFileSync(join(root, path), 'utf8')
}

function filesUnder(directory: string): string[] {
  const absolute = join(root, directory)
  const result: string[] = []
  const visit = (path: string): void => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const next = join(path, entry.name)
      if (entry.isDirectory()) visit(next)
      else if (entry.isFile() && /\.(?:ts|tsx)$/.test(entry.name)) {
        result.push(relative(root, next).replace(/\\/g, '/'))
      }
    }
  }
  visit(absolute)
  return result.sort()
}

function importSpecifiers(text: string): string[] {
  return [...text.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)].map((match) => match[1]!)
}

describe('ARCH-1 dependency ratchet', () => {
  it('keeps Core identity and transaction seams independent of concrete Surfaces and Features', () => {
    for (const path of [
      'src/renderer/authoring/courseAuthoringSession.ts',
      'src/renderer/authoring/editorTransaction.ts',
    ]) {
      const imports = importSpecifiers(source(path))
      expect(imports.filter((specifier) => (
        /(?:^|\/)course\//.test(specifier) ||
        /(?:^|\/)components\//.test(specifier) ||
        /(?:^|\/)ui\//.test(specifier)
      )), path).toEqual([])
      expect(source(path), path).not.toMatch(/\buseEditorStore\b|\bApp\.tsx\b/)
    }
  })

  it('keeps the Slide history seam free of App, UI, Media and raw Store dependencies', () => {
    const path = 'src/renderer/course/slideEditorCommands.ts'
    const text = source(path)
    expect(importSpecifiers(text).filter((specifier) => (
      /(?:^|\/)ui\//.test(specifier) ||
      /v9MediaAudioCommands/.test(specifier) ||
      /(?:^|\/)components\//.test(specifier)
    ))).toEqual([])
    expect(text).not.toMatch(/\buseEditorStore\b|\bApp\.tsx\b/)
    expect(text).toContain('commitSlideEditorTransactionHistory')
  })

  it('keeps Player independent from renderer Store modules', () => {
    const violations = filesUnder('src/player').flatMap((path) => (
      importSpecifiers(source(path))
        .filter((specifier) => /renderer\/store|renderer\\store/.test(specifier))
        .map((specifier) => `${path} -> ${specifier}`)
    ))
    expect(violations).toEqual([])
  })

  it('locks the image use-case onto the target planner and one transaction path', () => {
    const app = source('src/renderer/App.tsx')
    const store = source('src/renderer/store/editorStore.ts')
    expect(app).toContain('captureImageReplacementTarget()')
    expect(app).toContain('replaceImageAssetAtTarget(')
    expect(app).not.toMatch(/\breplaceImageAsset\(/)

    const start = store.indexOf('    replaceImageAssetAtTarget(target, asset, bytes) {')
    const end = store.indexOf('\n    importSound(', start)
    expect(start).toBeGreaterThanOrEqual(0)
    expect(end).toBeGreaterThan(start)
    const useCase = store.slice(start, end)
    expect(useCase).toContain('planCourseImageReplacement({')
    expect(useCase).toContain('createEditorTransactionStep(document, planned.plan)')
    expect(useCase).toContain('commitSlideEditorTransactionHistory(session.history, step)')
    expect(useCase).toContain('persistCandidateResult({')
    expect(useCase).not.toMatch(/runV9DocumentMutation|commitAssetTransaction/)
  })
})
