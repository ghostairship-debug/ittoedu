import { COMPONENT_RUNTIME_API_VERSION } from '../shared/constants'
import { componentRegistryKey, componentRuntimeSourceIdentity, type ComponentRegistryIdentityV1 } from '../shared/componentRegistryIdentity'
import type {
  ComponentDefinitionV4,
  ComponentManifest,
  ComponentRuntimeApiVersion,
} from '../shared/componentTypes'

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isComponentDefinition(value: unknown): value is ComponentDefinitionV4 {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const candidate = value as Record<string, unknown>
  const runtimeApiVersion = candidate.runtimeApiVersion
  return (
    typeof candidate.id === 'string' &&
    candidate.id.length > 0 &&
    runtimeApiVersion === COMPONENT_RUNTIME_API_VERSION &&
    typeof candidate.create === 'function'
  )
}

export class ComponentRegistry {
  private readonly definitions = new Map<string, ComponentDefinitionV4>()
  private readonly loadErrors = new Map<string, Error>()
  private readonly sources = new Map<string, string>()
  private readonly globalApi = {
    define: (definition: ComponentDefinitionV4): void => {
      this.defineDuringLoad(definition)
    },
  }

  private previousGlobalApi: Window['CoursewareComponent']
  private expectedId: string | null = null
  private expectedRuntimeApiVersion: ComponentRuntimeApiVersion | null = null
  private definitionDuringLoad: ComponentDefinitionV4 | null = null
  private installed = false

  install(): void {
    if (this.installed) {
      return
    }

    this.previousGlobalApi = window.CoursewareComponent
    window.CoursewareComponent = this.globalApi
    this.installed = true
  }

  executeRuntime(manifest: ComponentManifest, runtimeSource: string, identity?: ComponentRegistryIdentityV1): ComponentDefinitionV4
  executeRuntime(componentId: string, runtimeSource: string): ComponentDefinitionV4
  executeRuntime(
    manifestOrId: ComponentManifest | string,
    runtimeSource: string,
    identity?: ComponentRegistryIdentityV1,
  ): ComponentDefinitionV4 {
    const componentId = typeof manifestOrId === 'string'
      ? manifestOrId
      : manifestOrId.id
    const key = identity ? componentRegistryKey(identity) : componentId
    if (identity && (identity.packageId !== componentId ||
      (typeof manifestOrId !== 'string' && identity.version !== manifestOrId.version))) {
      throw new Error(`组件注册身份与 manifest 不匹配：${key}`)
    }
    const sourceIdentity = componentRuntimeSourceIdentity(runtimeSource)
    const existingSource = this.sources.get(key)
    if (identity && existingSource && existingSource !== sourceIdentity) {
      const error = new Error(`组件注册身份碰撞：${key}`)
      this.loadErrors.set(key, error)
      throw error
    }
    if (!runtimeSource.trim()) {
      const error = new Error(`组件“${componentId}”的 runtime.js 为空`)
      this.loadErrors.set(key, error)
      throw error
    }

    this.install()
    const previousDefinition = this.definitions.get(key)
    this.expectedId = componentId
    this.expectedRuntimeApiVersion = typeof manifestOrId === 'string'
      ? null
      : manifestOrId.runtimeApiVersion
    this.definitionDuringLoad = null

    try {
      const safeSourceName = componentId.replace(/[\r\n]/g, '_')
      const execute = new Function(
        'window',
        `"use strict";\n${runtimeSource}\n//# sourceURL=h5component://${safeSourceName}/runtime.js`,
      ) as (runtimeWindow: Window) => void
      execute(window)

      const registered = this.definitionDuringLoad as ComponentDefinitionV4 | null
      if (!registered) {
        throw new Error(`组件“${componentId}”没有调用 CoursewareComponent.define`)
      }

      const definition: ComponentDefinitionV4 = registered
      if (
        this.expectedRuntimeApiVersion !== null &&
        definition.runtimeApiVersion !== this.expectedRuntimeApiVersion
      ) {
        throw new Error(
          `组件运行时 API 不匹配：manifest 为 ${this.expectedRuntimeApiVersion}，runtime 为 ${definition.runtimeApiVersion}`,
        )
      }
      this.definitions.set(key, definition)
      this.sources.set(key, sourceIdentity)
      this.loadErrors.delete(key)
      return definition
    } catch (cause) {
      if (previousDefinition) {
        this.definitions.set(key, previousDefinition)
      } else {
        this.definitions.delete(key)
      }

      const error = new Error(`组件“${componentId}”注册失败：${errorMessage(cause)}`, {
        cause,
      })
      this.loadErrors.set(key, error)
      throw error
    } finally {
      this.expectedId = null
      this.expectedRuntimeApiVersion = null
      this.definitionDuringLoad = null
    }
  }

  loadRuntime(manifest: ComponentManifest, runtimeSource: string): ComponentDefinitionV4 {
    return this.executeRuntime(manifest, runtimeSource)
  }

  get(identity: string | ComponentRegistryIdentityV1): ComponentDefinitionV4 | undefined {
    return this.definitions.get(typeof identity === 'string' ? identity : componentRegistryKey(identity))
  }

  getLoadError(identity: string | ComponentRegistryIdentityV1): Error | undefined {
    return this.loadErrors.get(typeof identity === 'string' ? identity : componentRegistryKey(identity))
  }

  invalidate(identity: ComponentRegistryIdentityV1): void {
    const key = componentRegistryKey(identity)
    this.definitions.delete(key)
    this.sources.delete(key)
    this.loadErrors.delete(key)
  }

  dispose(): void {
    if (this.installed && window.CoursewareComponent === this.globalApi) {
      if (this.previousGlobalApi) {
        window.CoursewareComponent = this.previousGlobalApi
      } else {
        delete window.CoursewareComponent
      }
    }

    this.installed = false
    this.expectedId = null
    this.expectedRuntimeApiVersion = null
    this.definitionDuringLoad = null
    this.definitions.clear()
    this.sources.clear()
    this.loadErrors.clear()
  }

  private defineDuringLoad(definition: ComponentDefinitionV4): void {
    if (!this.expectedId) {
      throw new Error('当前没有正在加载的组件')
    }
    if (this.definitionDuringLoad) {
      throw new Error(`组件“${this.expectedId}”重复调用了 define`)
    }
    if (!isComponentDefinition(definition)) {
      throw new Error('组件定义格式无效；只支持 Component API 4')
    }
    if (definition.id !== this.expectedId) {
      throw new Error(
        `组件 ID 不匹配：期望“${this.expectedId}”，实际为“${definition.id}”`,
      )
    }

    this.definitionDuringLoad = definition
  }
}
