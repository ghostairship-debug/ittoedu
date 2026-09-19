import { describe, expect, it } from 'vitest'
import { normalizeWorkspacePath, sameWorkspacePath } from '../../src/shared/workspaceIdentity'
import { createWorkspaceIdentity } from '../../src/main/workspaceIdentity'

describe('workspace path normalization', () => {
  it('unifies separators, trailing slashes and Windows case', () => {
    expect(normalizeWorkspacePath('C:\\Lessons\\Circuit\\', 'win32')).toBe('c:/lessons/circuit')
    expect(normalizeWorkspacePath('c:/lessons/circuit', 'win32')).toBe('c:/lessons/circuit')
    expect(normalizeWorkspacePath('C:\\Lessons\\Circuit\\', 'linux')).toBe('c:/lessons/circuit')
    expect(normalizeWorkspacePath('/workspace/课例/', 'linux')).toBe('/workspace/课例')
    expect(createWorkspaceIdentity('p', 'C:\\Lessons\\a.h5lesson', 'win32').normalizedPath).toBe('c:/lessons/a.h5lesson')
  })

  it('compares two host paths under one rule and never matches an absent operand', () => {
    // UI 绑定判定曾各写各的 `.replace(/\\/g,'/').toLowerCase()`,都漏了尾斜杠规则——
    // 这条锁住「同一目录的不同写法算同一个」,以及 null/空串不得意外相等。
    expect(sameWorkspacePath('C:\\Lessons\\Circuit', 'c:/lessons/circuit')).toBe(true)
    expect(sameWorkspacePath('c:/lessons/circuit/', 'c:/lessons/circuit')).toBe(true)
    expect(sameWorkspacePath('c:/lessons/circuit', 'c:/lessons/circuit2')).toBe(false)
    expect(sameWorkspacePath(null, null)).toBe(false)
    expect(sameWorkspacePath('', '')).toBe(false)
    expect(sameWorkspacePath(undefined, 'c:/lessons/circuit')).toBe(false)
    expect(sameWorkspacePath('c:/a\0b', 'c:/a\0b')).toBe(false)
  })
})
