/**
 * Masks comments and literal contents before compatibility checks. The runtime
 * remains trusted code; these checks only reject module features that cannot be
 * bundled into the offline plain-script player.
 */
function maskCommentsAndLiterals(source: string): string {
  const masked = source.split('')
  const regexPrefixKeywords = new Set([
    'await',
    'case',
    'delete',
    'do',
    'else',
    'in',
    'instanceof',
    'new',
    'of',
    'return',
    'throw',
    'typeof',
    'void',
    'yield',
  ])

  const mask = (position: number): void => {
    if (masked[position] !== '\n' && masked[position] !== '\r') {
      masked[position] = ' '
    }
  }

  const maskQuotedString = (start: number, quote: "'" | '"'): number => {
    mask(start)
    let index = start + 1
    while (index < source.length) {
      const character = source[index]
      mask(index)
      index += 1
      if (character === '\\' && index < source.length) {
        mask(index)
        index += 1
        continue
      }
      if (character === quote) break
    }
    return index
  }

  const maskRegularExpression = (start: number): number => {
    mask(start)
    let index = start + 1
    let inCharacterClass = false
    while (index < source.length) {
      const character = source[index]
      if (character === '\n' || character === '\r') return index
      mask(index)
      index += 1
      if (character === '\\' && index < source.length) {
        mask(index)
        index += 1
        continue
      }
      if (character === '[') inCharacterClass = true
      if (character === ']') inCharacterClass = false
      if (character === '/' && !inCharacterClass) break
    }
    while (index < source.length && /[A-Za-z]/.test(source[index] ?? '')) {
      mask(index)
      index += 1
    }
    return index
  }

  function maskTemplate(start: number): number {
    mask(start)
    let index = start + 1
    while (index < source.length) {
      const character = source[index]
      const next = source[index + 1]
      if (character === '\\') {
        mask(index)
        index += 1
        if (index < source.length) {
          mask(index)
          index += 1
        }
        continue
      }
      if (character === '`') {
        mask(index)
        return index + 1
      }
      if (character === '$' && next === '{') {
        mask(index)
        mask(index + 1)
        index = maskCode(index + 2, true)
        if (source[index] === '}') {
          mask(index)
          index += 1
        }
        continue
      }
      mask(index)
      index += 1
    }
    return index
  }

  function maskCode(start: number, stopAtTemplateBrace: boolean): number {
    let index = start
    let nestedBraceDepth = 0
    let canStartRegex = true

    while (index < source.length) {
      const character = source[index]
      const next = source[index + 1]

      if (stopAtTemplateBrace && character === '}' && nestedBraceDepth === 0) {
        return index
      }

      if (character === '/' && next === '/') {
        mask(index)
        mask(index + 1)
        index += 2
        while (index < source.length && source[index] !== '\n') {
          mask(index)
          index += 1
        }
        continue
      }

      if (character === '/' && next === '*') {
        mask(index)
        mask(index + 1)
        index += 2
        while (index < source.length) {
          if (source[index] === '*' && source[index + 1] === '/') {
            mask(index)
            mask(index + 1)
            index += 2
            break
          }
          mask(index)
          index += 1
        }
        continue
      }

      if (character === "'" || character === '"') {
        index = maskQuotedString(index, character)
        canStartRegex = false
        continue
      }

      if (character === '`') {
        index = maskTemplate(index)
        canStartRegex = false
        continue
      }

      if (character === '/' && canStartRegex) {
        index = maskRegularExpression(index)
        canStartRegex = false
        continue
      }

      if (/[A-Za-z_$]/.test(character ?? '')) {
        const identifierStart = index
        index += 1
        while (index < source.length && /[\w$]/.test(source[index] ?? '')) {
          index += 1
        }
        const identifier = source.slice(identifierStart, index)
        canStartRegex = regexPrefixKeywords.has(identifier)
        continue
      }

      if (/\d/.test(character ?? '')) {
        index += 1
        while (index < source.length && /[\w.]/.test(source[index] ?? '')) {
          index += 1
        }
        canStartRegex = false
        continue
      }

      if (character === '{') {
        nestedBraceDepth += 1
        canStartRegex = true
      } else if (character === '}') {
        nestedBraceDepth = Math.max(0, nestedBraceDepth - 1)
        canStartRegex = false
      } else if (character === ')' || character === ']') {
        canStartRegex = false
      } else if (!/\s/.test(character ?? '')) {
        canStartRegex = character !== '.'
      }
      index += 1
    }

    return index
  }

  maskCode(0, false)
  return masked.join('')
}

export function validateRuntimeSource(source: string): void {
  if (source.trim().length === 0) {
    throw new Error('运行时源码为空')
  }

  const code = maskCommentsAndLiterals(source)
  if (/(?<![.$\w])\bimport\b\s*(?:\(|\.|\{|\*|[A-Za-z_$]|$)/m.test(code)) {
    throw new Error('运行时源码不能使用 import；请将依赖预先打包为普通 JavaScript')
  }
  if (
    /(?<![.$\w])\bexport\b\s+(?:default\b|const\b|let\b|var\b|function\b|class\b|\{|\*|type\b|interface\b|enum\b|namespace\b)/m
      .test(code)
  ) {
    throw new Error('运行时源码不能使用 export；请通过 CoursewareRuntime.define 注册')
  }
  if (/(?<![.$\w])\brequire\b/m.test(code)) {
    throw new Error('运行时源码不能使用 require；请将依赖预先打包为普通 JavaScript')
  }
}
