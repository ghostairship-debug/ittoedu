import type { ComponentDefinition } from '../../shared/contracts/component-platform'
export const CHART_DEFINITION: ComponentDefinition = { id: 'guoling.chart', role: 'content', implementation: { kind: 'builtin', key: 'guoling.chart' }, title: '图表' }
export * from './data'
export * from './edit'
export * from './render'
export * from './runtime'
export * from './output'
