import { expect, it, vi } from 'vitest'
import { prepareTextFonts } from '../../src/shared/fonts/ensureBundledFonts'
import { textNodeFontRequests } from '../../src/shared/textLayout'
import { createTextNode } from '../../src/core/tools/nativeNodeFactories'

it('prepares current code-point run fonts in the supplied realm and retries a failed demand', async () => {
  const node = createTextNode({ text: 'A𠀀B', style: { fontFamily: 'Noto Sans SC', fontSize: 24 },
    runs: [{ start: 1, end: 2, style: { bold: true, fontFamily: 'STIX Two Math' } }] })
  const requests = textNodeFontRequests(node)
  expect(requests).toEqual([{ font: '400 24px Noto Sans SC', text: 'AB' }, { font: '700 24px STIX Two Math', text: '𠀀' }])
  const first = { check: vi.fn(() => false), load: vi.fn(async () => []) }
  await prepareTextFonts(requests, first)
  expect(first.load.mock.calls).toEqual(requests.map(({ font, text }) => [font, text]))
  const other = { check: vi.fn(() => false), load: vi.fn().mockRejectedValueOnce(new Error('local font failure')).mockResolvedValue([]) }
  await expect(prepareTextFonts([requests[0]!], other)).rejects.toThrow('local font failure')
  await prepareTextFonts([{ font: requests[0]!.font, text: '新字符' }], other)
  expect(other.load).toHaveBeenLastCalledWith(requests[0]!.font, '新字符')
  first.check.mockReturnValue(true)
  expect(prepareTextFonts(requests, first)).toBeUndefined()
})
