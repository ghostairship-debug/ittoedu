import type { RuntimeApiVersion, RuntimeDefinition } from '../shared/runtimeTypes'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

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

function isRuntimeDefinition(value: unknown): value is RuntimeDefinition {
  if (typeof value !== 'object' || value === null) return false
  const runtimeApiVersion = Reflect.get(value, 'runtimeApiVersion')
  const authoringApiVersion = Reflect.get(value, 'authoringApiVersion')
  return (
    runtimeApiVersion === 2 &&
    (authoringApiVersion === undefined || authoringApiVersion === 1) &&
    typeof Reflect.get(value, 'create') === 'function'
  )
}

export class RuntimeRegistry {
  private readonly targetWindow: Window
  private readonly globalApi = Object.freeze({
    define: (definition: RuntimeDefinition): void => {
      this.defineDuringLoad(definition)
    },
  })

  private previousGlobalApi: Window['CoursewareRuntime']
  private previousGlobalWasOwnProperty = false
  private definitionDuringLoad: RuntimeDefinition | null = null
  private loadingLabel: string | null = null
  private installed = false

  constructor(targetWindow: Window = window) {
    this.targetWindow = targetWindow
  }

  install(): void {
    if (this.installed) return
    this.previousGlobalApi = this.targetWindow.CoursewareRuntime
    this.previousGlobalWasOwnProperty = Object.prototype.hasOwnProperty.call(
      this.targetWindow,
      'CoursewareRuntime',
    )
    this.targetWindow.CoursewareRuntime = this.globalApi
    this.installed = true
  }

  executeRuntime(
    runtimeSource: string,
    label = '自由运行时',
    expectedRuntimeApiVersion?: RuntimeApiVersion,
  ): RuntimeDefinition {
    validateRuntimeSource(runtimeSource)
    if (this.loadingLabel !== null) {
      throw new Error(`运行时“${this.loadingLabel}”尚未完成同步注册`)
    }

    this.install()
    this.loadingLabel = label
    this.definitionDuringLoad = null

    try {
      const safeLabel = label.replace(/[\r\n]/g, '_')
      const RealmFunction = Reflect.get(this.targetWindow, 'Function')
      if (typeof RealmFunction !== 'function') {
        throw new Error('运行时宿主缺少 Function 构造器')
      }
      const execute = RealmFunction(
        'window',
        'CoursewareRuntime',
        `"use strict";\n${runtimeSource}\n//# sourceURL=h5lesson-runtime://${safeLabel}/runtime.js`,
      ) as (
        runtimeWindow: Window,
        runtimeApi: typeof this.globalApi,
      ) => void
      execute(this.targetWindow, this.globalApi)

      if (!this.definitionDuringLoad) {
        throw new Error('没有同步调用 CoursewareRuntime.define')
      }
      const definition = this.definitionDuringLoad as RuntimeDefinition
      if (
        expectedRuntimeApiVersion !== undefined &&
        definition.runtimeApiVersion !== expectedRuntimeApiVersion
      ) {
        throw new Error(
          `运行时 API 不匹配：文档为 ${expectedRuntimeApiVersion}，源码为 ${definition.runtimeApiVersion}`,
        )
      }
      return definition
    } catch (cause) {
      throw new Error(`运行时“${label}”注册失败：${errorMessage(cause)}`, { cause })
    } finally {
      this.loadingLabel = null
      this.definitionDuringLoad = null
    }
  }

  dispose(): void {
    if (this.installed && this.targetWindow.CoursewareRuntime === this.globalApi) {
      if (this.previousGlobalWasOwnProperty) {
        this.targetWindow.CoursewareRuntime = this.previousGlobalApi
      } else {
        delete this.targetWindow.CoursewareRuntime
      }
    }

    this.installed = false
    this.previousGlobalApi = undefined
    this.previousGlobalWasOwnProperty = false
    this.loadingLabel = null
    this.definitionDuringLoad = null
  }

  private defineDuringLoad(definition: RuntimeDefinition): void {
    if (this.loadingLabel === null) {
      throw new Error('当前没有正在加载的运行时')
    }
    if (this.definitionDuringLoad !== null) {
      throw new Error(`运行时“${this.loadingLabel}”重复调用了 define`)
    }
    if (!isRuntimeDefinition(definition)) {
      throw new Error(
        '运行时定义格式无效：只支持 runtimeApiVersion 2、可选 authoringApiVersion 1 和 create()',
      )
    }
    this.definitionDuringLoad = definition
  }
}
