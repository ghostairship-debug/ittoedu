import type { ComponentRuntimeImplementation, JsonValue } from '../../shared/contracts/component-platform'
import { readTeacherControllerConfig } from '../../shared/teacherControllerConfig'
import { mount } from './defaultController'
import defaultTeacherControllerSource from './defaultController.ts?raw'
import type { TeacherControllerData, TeacherControllerPort } from './types'

export * from './types'
export * from './data'
export { defaultTeacherControllerSource }

export function createTeacherControllerRuntimeImplementation(
  port: TeacherControllerPort | undefined,
): ComponentRuntimeImplementation {
  return {
    mount(context) {
      const normalize = (data: JsonValue): TeacherControllerData => {
        const record = data && typeof data === 'object' && !Array.isArray(data) ? data : {}
        return { ...record, ...readTeacherControllerConfig(record), enabled: record.enabled !== false } as TeacherControllerData
      }
      const mounted = mount({ ...context, instance: { ...context.instance, data: normalize(context.instance.data) }, teacherController: port })
      return { ...mounted, update: instance => mounted.update({ ...instance, data: normalize(instance.data) }) }
    },
  }
}
