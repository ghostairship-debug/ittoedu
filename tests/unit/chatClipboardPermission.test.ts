import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { isAllowedRendererPermission } from '../../src/main/security'

describe('chat copy permissions and selection', () => {
  it('allows only sanitized clipboard write for the main renderer', () => {
    expect(isAllowedRendererPermission('clipboard-sanitized-write')).toBe(true)
    expect(isAllowedRendererPermission('clipboard-read')).toBe(false)
    expect(isAllowedRendererPermission('notifications')).toBe(false)
    expect(isAllowedRendererPermission('media')).toBe(false)
  })

  it('overrides global user-select none on chat transcript text', () => {
    const globals = readFileSync(path.join(process.cwd(), 'src/renderer/styles/globals.css'), 'utf8')
    const chat = readFileSync(path.join(process.cwd(), 'src/renderer/ui/chat/course-chat.css'), 'utf8')
    expect(globals).toMatch(/body[\s\S]*user-select:\s*none/)
    expect(globals).toMatch(/\.chat-message[\s\S]*user-select:\s*text/)
    expect(chat).toMatch(/\.chat-message[\s\S]*user-select:\s*text/)
  })
})
