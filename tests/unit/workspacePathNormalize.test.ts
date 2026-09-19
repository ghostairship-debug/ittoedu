import { describe, expect, it } from 'vitest'
import { normalizeWorkspacePath } from '../../src/shared/workspaceIdentity'
import { createWorkspaceIdentity } from '../../src/main/workspaceIdentity'

describe('workspace path normalization', () => {
  it('unifies separators, trailing slashes and Windows case', () => {
    expect(normalizeWorkspacePath('C:\\Lessons\\Circuit\\', 'win32')).toBe('c:/lessons/circuit')
    expect(normalizeWorkspacePath('c:/lessons/circuit', 'win32')).toBe('c:/lessons/circuit')
    expect(normalizeWorkspacePath('C:\\Lessons\\Circuit\\', 'linux')).toBe('c:/lessons/circuit')
    expect(normalizeWorkspacePath('/workspace/课例/', 'linux')).toBe('/workspace/课例')
    expect(createWorkspaceIdentity('p', 'C:\\Lessons\\a.h5lesson', 'win32').normalizedPath).toBe('c:/lessons/a.h5lesson')
  })
})
