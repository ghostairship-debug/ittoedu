import { describe, expect, it } from 'vitest'
import { isAllowedRendererPermission } from '../../src/main/security'

describe('chat copy permissions and selection', () => {
  it('allows only sanitized clipboard write and fullscreen for the main renderer', () => {
    expect(isAllowedRendererPermission('clipboard-sanitized-write')).toBe(true)
    // The teacher controller's 全屏 in the whole-course preview and try-run (M19).
    expect(isAllowedRendererPermission('fullscreen')).toBe(true)
    expect(isAllowedRendererPermission('clipboard-read')).toBe(false)
    expect(isAllowedRendererPermission('notifications')).toBe(false)
    expect(isAllowedRendererPermission('media')).toBe(false)
  })

})
