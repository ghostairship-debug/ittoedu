import { expect, it } from 'vitest'
import { normalizeNewFilename } from '../../src/renderer/lessonWorkspace/workspaceFilesNaming'

it('adds the missing extension of each new file type', () => {
  expect(normalizeNewFilename('create-markdown', ' 笔记 ')).toBe('笔记.md')
  expect(normalizeNewFilename('create-course', '竖屏测试')).toBe('竖屏测试.glx')
  expect(normalizeNewFilename('create-text', '记录')).toBe('记录.txt')
  expect(normalizeNewFilename('create-text', '数据.csv')).toBe('数据.csv')
  expect(normalizeNewFilename('mkdir', '素材')).toBe('素材')
})

it('keeps one extension when a whole name is typed over the selected stem', () => {
  expect(normalizeNewFilename('create-course', '竖屏测试.glx.glx')).toBe('竖屏测试.glx')
  expect(normalizeNewFilename('create-course', '竖屏测试.GLX.glx')).toBe('竖屏测试.glx')
  expect(normalizeNewFilename('create-course', '竖屏测试.h5lesson')).toBe('竖屏测试.glx')
  expect(normalizeNewFilename('create-markdown', '笔记.md.md')).toBe('笔记.md')
  expect(normalizeNewFilename('create-text', '记录.txt.txt')).toBe('记录.txt')
  // Different extensions are the user's choice.
  expect(normalizeNewFilename('create-markdown', 'README.txt.md')).toBe('README.txt.md')
})
