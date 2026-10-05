import type { ComponentDefinition } from '../../shared/contracts/component-platform'

export const IMAGE_DEFINITION: ComponentDefinition = {
  id: 'guoling.image', role: 'content', title: '图片', version: '1.0.0',
  implementation: { kind: 'builtin', key: 'guoling.image' },
}

export * from './data'
export * from './edit'
export * from './runtime'
export * from './transform'

// Composition root injects its resource URL resolver before mounting.
export { createImageRuntimeImplementation as imageRuntimeImplementation } from './runtime'
