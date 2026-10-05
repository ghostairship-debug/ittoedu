import type { ComponentRuntimeImplementation } from '../../shared/contracts/component-platform/runtime'
import { createTeacherControllerRuntimeImplementation } from '../teacher-controller'

const implementation: ComponentRuntimeImplementation = {
  mount(context) {
    return createTeacherControllerRuntimeImplementation(context.teacherController).mount(context)
  },
}
export default implementation
