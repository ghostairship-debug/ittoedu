import { imageDataSchema } from '../../../components/image/data'
import { componentDefinitionBuiltinKey, type ComponentInstance, type CourseProjectV10 } from '../../../shared/contracts/component-platform'

/** Author guides are disposable paint only; image runtime/export keep the source unchanged. */
export function ImageSafeAreaGuides({ instance, project }: { instance: ComponentInstance; project: CourseProjectV10 }) {
  if (componentDefinitionBuiltinKey(project.definitions[instance.definitionId]) !== 'guoling.image') return null
  const parsed = imageDataSchema.safeParse(instance.data)
  if (!parsed.success || !parsed.data.safeAreas.length) return null
  return <svg data-image-safe-area-guides={instance.id} width="100%" height="100%"
    style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'visible' }} aria-label="图片安全区引导">
    {parsed.data.safeAreas.map(area => <g key={area.id}><rect data-image-safe-area={area.id} x={`${area.x * 100}%`} y={`${area.y * 100}%`}
      width={`${area.width * 100}%`} height={`${area.height * 100}%`} fill="none" stroke="#ea4bb1" strokeWidth={1} strokeDasharray="5 3" vectorEffect="non-scaling-stroke" />
      <text x={`${area.x * 100}%`} y={`${area.y * 100}%`} dx={3} dy={12} fill="#a51b73" fontSize={11}>{area.label}</text></g>)}
  </svg>
}
