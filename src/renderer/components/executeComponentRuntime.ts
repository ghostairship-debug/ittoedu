import { UserFacingError } from '@/shared/errors'
import type { ComponentDefinitionV4 } from '@/shared/componentTypes'
import { ComponentRegistry } from './ComponentRegistry'
import { validateComponentRuntimeSource } from '../../core/drivers/codecs/importComponentPackage'

export interface ExecuteComponentRuntimeOptions {
  registry?: ComponentRegistry
}

export type ComponentRuntimeExecutionResult =
  | { ok: true; definition: ComponentDefinitionV4 }
  | { ok: false; error: UserFacingError }

/**
 * Components are explicitly trusted local code. Supplying a small
 * `window` object prevents accidental dependence on editor globals, but this is
 * deliberately not presented as a security sandbox.
 */
export function executeComponentRuntime(
  runtimeSource: string,
  expectedId: string,
  options: ExecuteComponentRuntimeOptions = {},
): ComponentDefinitionV4 {
  const registry = options.registry ?? new ComponentRegistry()
  const capturedDefinitions = new ComponentRegistry()
  const registrationApi = Object.freeze({
    define: (definition: unknown) => {
      if (
        typeof definition === 'object' &&
        definition !== null &&
        typeof Reflect.get(definition, 'id') === 'string' &&
        Reflect.get(definition, 'id') !== expectedId
      ) {
        throw new UserFacingError(
          '组件注册失败',
          `组件 ID 不匹配：需要“${expectedId}”，runtime 注册了“${String(Reflect.get(definition, 'id'))}”。`,
          '请导入 ID 与 manifest.json 一致的组件包。',
        )
      }
      capturedDefinitions.define(definition)
    },
  })
  const runtimeWindow = Object.freeze({ CoursewareComponent: registrationApi })

  try {
    validateComponentRuntimeSource(runtimeSource)
    const evaluate = new Function(
      'window',
      'CoursewareComponent',
      `"use strict";\n${runtimeSource}\n//# sourceURL=h5component-runtime.js`,
    ) as (windowValue: object, api: typeof registrationApi) => void
    evaluate(runtimeWindow, registrationApi)

    const newDefinitions = capturedDefinitions.list()
    if (newDefinitions.length === 0) {
      throw new UserFacingError(
        '组件注册失败',
        `runtime.js 没有注册组件“${expectedId}”。`,
        '请确认脚本会同步调用 window.CoursewareComponent.define()。',
      )
    }
    if (newDefinitions.length > 1) {
      throw new UserFacingError(
        '组件注册失败',
        '一个组件 runtime.js 只能注册一个组件。',
        '请移除额外的 define() 调用后重新导入。',
      )
    }
    const definition = capturedDefinitions.require(expectedId)
    registry.define(definition)
    return definition
  } catch (error) {
    if (error instanceof UserFacingError) throw error
    console.error('组件 runtime 执行失败', error)
    throw new UserFacingError(
      '组件加载失败',
      `组件“${expectedId}”的 runtime.js 执行异常。`,
      '请确认组件来自可信来源并联系组件作者修复。',
      { cause: error },
    )
  }
}

export function tryExecuteComponentRuntime(
  runtimeSource: string,
  expectedId: string,
  options: ExecuteComponentRuntimeOptions = {},
): ComponentRuntimeExecutionResult {
  try {
    return {
      ok: true,
      definition: executeComponentRuntime(runtimeSource, expectedId, options),
    }
  } catch (error) {
    if (error instanceof UserFacingError) return { ok: false, error }
    return {
      ok: false,
      error: new UserFacingError(
        '组件加载失败',
        `组件“${expectedId}”加载异常。`,
        '请联系组件作者修复。',
        { cause: error },
      ),
    }
  }
}

export { ComponentRegistry }
