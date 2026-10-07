// @vitest-environment node
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { DocumentHostService } from '../../src/main/workbench/DocumentHostService'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { createTextComponentData } from '../../src/components/text/data'
import { useEditorStore } from '../../src/renderer/store/editorStore'
import { createSlideLightEditingPort } from '../../src/renderer/composition/selection/slideLightEditingPort'
import { componentPropertiesView } from '../../src/renderer/ui/properties/componentProperties'
import type { DocumentHostAPI } from '../../src/shared/workbench/desktop'

it('light line spacing reads the professional value and commits the same field with one History entry', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'course-light-controls-'))
  try {
    const host = new DocumentHostService(root), project = createBlankCourseProjectV10(), data = createTextComponentData('专业文字')
    data.appearance.lineSpacing = 4
    project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
    project.instances.text = { id: 'text', definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(data)),
      frame: { transform: [1, 0, 0, 1, 20, 20], width: 360, height: 120 } }
    project.surfaces[0]!.childIds.push('text')
    const snapshot = await host.internalAPI.create({ kind: 'course-v10', project, resources: { assets: {}, components: {} } }, 'light-controls.h5lesson')
    const unavailable = async (): Promise<never> => { throw new Error('Outside light control fixture') }
    const api: DocumentHostAPI = { ...host.internalAPI, bootstrapCourse: async () => snapshot, subscribe: host.subscribeEvents.bind(host),
      saveWithDialog: unavailable, closeWithDialog: unavailable, close: unavailable, discardRecovery: unavailable }
    await useEditorStore.getState().connectCourseDocuments(api)
    const state = useEditorStore.getState(); state.selectNode('text')
    const light = createSlideLightEditingPort({ kernel: state.courseKernel }), target = light.captureObject()!
    expect(light.viewObject(target).lineSpacing).toBe(4)
    const command = light.viewObject(target).commands.find(value => value.id === 'slide.spacing.8')!
    await light.runObject(target, command)
    const current = await host.internalAPI.read(snapshot.documentId)
    expect(current.undoDepth).toBe(1)
    if (current.model.kind !== 'course-v10') throw new Error('Expected current V10 project')
    expect(current.model.project.instances.text.data).toMatchObject({ appearance: { lineSpacing: 8, lineHeight: data.appearance.lineHeight } })
    const professional = componentPropertiesView(current.model.project.instances.text, current.model.project.definitions[TEXT_DEFINITION.id])
    expect(professional.type === 'text' && professional.style.lineSpacing).toBe(8)
    expect(light.viewObject(light.captureObject()!).lineSpacing).toBe(8)
  } finally {
    useEditorStore.getState().courseBridge.dispose()
    await fs.rm(root, { recursive: true, force: true })
  }
})
