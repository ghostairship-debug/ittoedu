import { validateRuntimeSource } from '../shared/runtimeSourceValidation'
export { validateRuntimeSource } from '../shared/runtimeSourceValidation'
import type { RuntimeApiVersion, RuntimeDefinition } from '../shared/runtimeTypes'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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
