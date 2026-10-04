import { useEffect, useMemo, useRef } from 'react'
import { courseComponentNameKey } from '../../../shared/composition/projectReferences'
import { courseThemeStyleText } from '../../../shared/contracts/design-v1/theme'
import type { FlowBlock } from '../../../shared/courseProjectTypes'
import { FLOW_COMPONENT_BLOCK_HEIGHT } from '../../../shared/flowBodyPresentation'
import { mountCourseComponentBlock } from '../../../player/surfaces/flow/courseComponentBlock'
import { createPublishedSurfaceRuntimeSession } from '../../../player/surfaces/runtime/publishedSurfaceRuntimeMount'
import { publishCourseComponent } from '../../export/course/buildPublishedCourse'
import { selectActiveCourseProjectDocument, useEditorStore } from '../../store/editorStore'

/** A `course-component` block while editing: the named component runs as playback runs it, or its placeholder shows. */
export function FlowCourseComponentBlockView({ block, width, assetUrls }: {
  block: Extract<FlowBlock, { type: 'course-component' }>
  width: number
  assetUrls: Readonly<Record<string, string>>
}) {
  const container = useRef<HTMLDivElement>(null)
  const urls = useRef(assetUrls)
  urls.current = assetUrls
  const components = useEditorStore(state => selectActiveCourseProjectDocument(state)?.components)
  const designTokens = useEditorStore(state => selectActiveCourseProjectDocument(state)?.designTokens)
  const courseTheme = useEditorStore(state => selectActiveCourseProjectDocument(state)?.theme)
  const key = courseComponentNameKey(block.name)
  const definition = Object.entries(components ?? {}).find(([name]) => courseComponentNameKey(name) === key)?.[1]
  const runtime = useMemo(() => definition ? publishCourseComponent(definition) : undefined, [definition])
  const theme = useMemo(() => designTokens ? courseThemeStyleText({ designTokens, theme: courseTheme }, id => urls.current[id]) : undefined,
    [designTokens, courseTheme])
  const height = block.height ?? FLOW_COMPONENT_BLOCK_HEIGHT

  useEffect(() => {
    const target = container.current
    if (!target) return
    const session = createPublishedSurfaceRuntimeSession()
    const handle = mountCourseComponentBlock(target, {
      block, runtime, width: target.clientWidth || width, height, mode: 'authoring', visible: true,
      ...(theme ? { theme } : {}), resolveAsset: id => urls.current[id], session,
    })
    const observer = typeof ResizeObserver === 'function'
      ? new ResizeObserver(() => { if (target.clientWidth > 0) handle.resize(target.clientWidth, height) }) : null
    observer?.observe(target)
    return () => { observer?.disconnect(); handle.destroy(); session.destroy() }
  }, [block.id, block.name, block.title, runtime, theme, height])

  return <div ref={container} data-flow-course-component={block.name} style={{ position: 'relative', width: '100%', height }} />
}
