const normalize = (text: string) => text.replace(/\r\n/g, '\n')

/** Prefer byte-equivalent text. Newline equivalence is used only when that exact match is absent. */
export function matchTextPatch(source: string, oldText: string, newText: string, range?: { from: number; to: number }) {
  if (!oldText.length) throw new Error('补丁原文不能为空')
  let from: number, to: number, equivalent = false
  if (range) {
    ({ from, to } = range)
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to < from || to > source.length)
      throw new Error('补丁范围无效，请重新读取')
    const actual = source.slice(from, to)
    if (actual !== oldText) {
      if (normalize(actual) !== normalize(oldText)) throw new Error('补丁范围或原文已改变，请重新读取')
      equivalent = true
    }
  } else {
    from = source.indexOf(oldText)
    if (from >= 0) {
      if (source.indexOf(oldText, from + 1) >= 0) throw new Error('补丁原文匹配多处，请提供精确 range')
      to = from + oldText.length
    } else {
      const removedAt: number[] = []
      const normalized = source.replace(/\r\n/g, (_value, offset: number) => { removedAt.push(offset - removedAt.length); return '\n' })
      const wanted = normalize(oldText), index = normalized.indexOf(wanted)
      if (index < 0) throw new Error('补丁原文不存在，请重新读取')
      if (normalized.indexOf(wanted, index + 1) >= 0) throw new Error('换行等价原文匹配多处，请提供精确 range')
      const raw = (offset: number) => {
        let low = 0, high = removedAt.length
        while (low < high) { const middle = (low + high) >>> 1; if (removedAt[middle]! < offset) low = middle + 1; else high = middle }
        return offset + low
      }
      from = raw(index); to = raw(index + wanted.length); equivalent = true
    }
  }
  const endings = source.slice(from, to).match(/\r\n|\n/g) ?? []
  let index = 0
  const text = equivalent ? newText.replace(/\r?\n/g, () => endings[index++] ?? endings.at(-1) ?? '\n') : newText
  return { from, to, text, equivalent }
}
