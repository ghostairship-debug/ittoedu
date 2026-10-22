import { testContainerInstance } from '../helpers/glxWorkFixture'
import { componentSurfaces } from '../../src/shared/contracts/component-platform/project'
import { TextSelection } from 'prosemirror-state'
import { createCourseDocumentClipboardContext, readCourseDocumentClipboardContext } from '../../src/renderer/document/documentClipboardContext'
import { createFlowDocumentResourcePort, prepareFlowDocumentResourceTransaction } from '../../src/renderer/document/flowDocumentResources'
import { owningContainer } from '../../src/shared/contracts/component-platform'
import { expect, it } from 'vitest'
import { createLayoutEditor } from '../../src/renderer/document/editorSession'
import { projectFlowDocument, flowDocumentEdits } from '../../src/core/components/document/flowDocumentProjection'
import { createBlankCourseProjectV10 } from '../../src/core/course/createCourseProjectV10'
import { TEXT_DEFINITION } from '../../src/components/text/adapters'
import { createTextComponentData, textComponentDataSchema } from '../../src/components/text/data'
import { componentTextInteractionEdits } from '../../src/core/course/componentTextInteractionEdits'
import { applyComponentOperation, captureComponentOperation } from '../../src/core/drivers/courseV10Operations'
import { inlineComponentIds, documentTextRanges } from '../../src/shared/document/textInteraction'

it('submits the actual professional editor range projection for repeated text deletion', () => {
  let project = createBlankCourseProjectV10('正文')
  testContainerInstance(project, 0).container!.kind = 'flow'; testContainerInstance(project, 0).childIds = ['body']; project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  project.instances.body = { id: 'body', definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(createTextComponentData('甲甲甲'))) }
  const note = componentTextInteractionEdits(project, { surfaceId: componentSurfaces(project)[0].id, instanceId: 'body', dataPath: ['content'], from: 0, to: 1 }, { kind: 'annotation', content: '第一个甲' })
  project = applyComponentOperation(project, captureComponentOperation(project, note.edits))
  const host = document.createElement('div'); document.body.append(host)
  const messages: string[] = []
  const editor = createLayoutEditor(host, { document: projectFlowDocument(project, componentSurfaces(project)[0].id), revision: String(project.revision), presentation: 'flow',
    undo() {}, redo() {}, diagnostic: message => messages.push(message), change(next, operation) {
      const edits = flowDocumentEdits(project, componentSurfaces(project)[0].id, next.content.blocks, project, operation.rangeProjection)
      project = applyComponentOperation(project, captureComponentOperation(project, edits)); return true
    } })
  try {
    editor.view.dispatch(editor.view.state.tr.delete(1, 2))
    expect(messages).toEqual([])
    expect(textComponentDataSchema.parse(project.instances.body.data).content.inlines).toEqual([{ type: 'text', text: '甲甲' }])
    expect(project.instances[note.instanceId]).toBeUndefined()
    expect(documentTextRanges(textComponentDataSchema.parse(project.instances.body.data).content).size).toBe(0)
  } finally { editor.destroy(); host.remove() }
})


it('uses actual editor copy/cut/paste events for a partial range and inline atom with formal source context', async () => {
  let project = createBlankCourseProjectV10('剪贴板')
  const surfaceId = componentSurfaces(project)[0].id; testContainerInstance(project, 0).container!.kind = 'flow'; testContainerInstance(project, 0).childIds = ['body','destination']; project.definitions[TEXT_DEFINITION.id] = TEXT_DEFINITION
  for (const [id,text] of [['body','前甲乙后'],['destination','粘贴：']]) project.instances[id] = { id, definitionId: TEXT_DEFINITION.id, data: JSON.parse(JSON.stringify(createTextComponentData(text))) }
  const apply = (edits: Parameters<typeof captureComponentOperation>[1]) => { project = applyComponentOperation(project, captureComponentOperation(project, edits)) }
  const note = componentTextInteractionEdits(project, { surfaceId, instanceId: 'body', dataPath: ['content'], from: 1, to: 3 }, { kind: 'annotation', content: '注释' }); apply(note.edits)
  const answer = componentTextInteractionEdits(project, { surfaceId, instanceId: 'body', dataPath: ['content'], from: 2, to: 2 }, { kind: 'input', acceptedAnswers: ['答案'] }); apply(answer.edits)
  const target = () => ({ documentId: 'document', epoch: 'epoch', activation: 1, project, resources: { assets: {}, components: {} }, editingProject: project, activeStateId: null, surfaceId, instanceIds: [], instanceId: null })
  const messages: string[] = [], host = document.createElement('div'); document.body.append(host)
  const editor = createLayoutEditor(host, { document: projectFlowDocument(project,surfaceId), revision: String(project.revision), presentation: 'flow', undo() {}, redo() {}, diagnostic: message => messages.push(message),
    clipboardContext: (_resources: unknown, content: import('../../src/shared/document/content').DocumentContent) => createCourseDocumentClipboardContext({ documentId: 'document', project, resources: {assets:{},components:{}}, roots: content.blocks.map(block => block.id) }),
    clipboardResourcePort: context => createFlowDocumentResourcePort({ target: target(), source: readCourseDocumentClipboardContext(context) }),
    change(next, operation) { const plan = prepareFlowDocumentResourceTransaction(target(), surfaceId, next.content.blocks, operation.preparedResourceBatches ?? (operation.preparedResources === undefined ? [] : [operation.preparedResources]), operation.rangeProjection); apply(plan.edits); return true }
  })
  const values = new Map<string,string>(), clipboardData = { setData: (type:string,value:string) => values.set(type,value), getData: (type:string) => values.get(type) ?? '', types: [] }
  const event = (type:string) => { const value = new Event(type,{bubbles:true,cancelable:true}); Object.defineProperty(value,'clipboardData',{value:clipboardData}); editor.view.dom.dispatchEvent(value); return value }
  try {
    editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc,2,5)))
    expect(event('copy').defaultPrevented).toBe(true)
    expect(JSON.parse(values.get('application/x-cw-document-slice')!).context.kind).toBe('cw-course-v10-resources')
    expect(event('cut').defaultPrevented).toBe(true); await editor.drain()
    expect(textComponentDataSchema.parse(project.instances.body.data).content.inlines).toEqual([{type:'text',text:'前后'}])
    let position = -1; editor.view.state.doc.descendants((node,pos) => { if(node.attrs.id === 'destination')position = pos+1+3 })
    editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc,position)))
    event('paste'); await editor.drain()
    expect(messages).toEqual([])
    const pasted = textComponentDataSchema.parse(project.instances.destination.data).content, id = inlineComponentIds(pasted)[0]
    expect(id).toBeDefined(); expect(project.instances[id]).toBeDefined(); expect(owningContainer(project,id)).toEqual({kind:'instance',instanceId:'destination'})
    const annotation = Object.values(project.instances).find(instance => instance.attachments?.some(attachment => attachment.target.kind === 'text-range' && attachment.target.instanceId === 'destination'))
    expect(annotation).toBeDefined(); expect(documentTextRanges(pasted).size).toBe(1)
    // The same actual open text slice must use the formal resource port at copy-drop.
    editor.view.state.doc.descendants((node,pos) => { if(node.attrs.id === 'destination')position = pos+1+3 })
    editor.view.dispatch(editor.view.state.tr.setSelection(TextSelection.create(editor.view.state.doc,position,position+3)))
    const dragged = editor.view.state.selection.content()
    let bodyEnd = -1; editor.view.state.doc.descendants((node,pos) => { if(node.attrs.id === 'body') bodyEnd = pos+node.nodeSize-1 })
    const originalPosAtCoords = editor.view.posAtCoords
    editor.view.posAtCoords = () => ({pos:bodyEnd,inside:0}) // Geometry alone is supplied by this headless editor fixture.
    const dropped = editor.view.someProp('handleDrop', handler => handler(editor.view, {clientX:1,clientY:1} as DragEvent, dragged, false))
    editor.view.posAtCoords = originalPosAtCoords
    expect(dropped).toBe(true); await editor.drain()
    expect(messages).toEqual([])
    const droppedContent = textComponentDataSchema.parse(project.instances.body.data).content, droppedId = inlineComponentIds(droppedContent)[0]
    expect(droppedId).toBeDefined(); expect(droppedId).not.toBe(id); expect(owningContainer(project,droppedId)).toEqual({kind:'instance',instanceId:'body'})
    expect(documentTextRanges(droppedContent).size).toBe(1)
    // A native PM move keeps the very same atom and annotation while adopting its new paragraph.
    let from = -1, to = -1, destinationEnd = -1
    editor.view.state.doc.descendants((node,pos) => { if(node.attrs.id === 'body'){from = pos+1+2;to = from+3} if(node.attrs.id === 'destination')destinationEnd = pos+node.nodeSize-1 })
    const moved = editor.view.state.doc.slice(from,to), transaction = editor.view.state.tr.delete(from,to)
    transaction.replaceRange(transaction.mapping.map(destinationEnd),transaction.mapping.map(destinationEnd),moved)
    editor.view.dispatch(transaction); await editor.drain()
    expect(messages).toEqual([])
    expect(inlineComponentIds(textComponentDataSchema.parse(project.instances.body.data).content)).toEqual([])
    expect(owningContainer(project,droppedId)).toEqual({kind:'instance',instanceId:'destination'})
    expect(project.instances[droppedId]).toBeDefined()
    const movedAnnotation = Object.values(project.instances).find(instance => instance.attachments?.some(attachment => attachment.target.kind === 'text-range' && attachment.target.instanceId === 'destination' && documentTextRanges(textComponentDataSchema.parse(project.instances.destination.data).content).has(attachment.target.rangeId)))
    expect(movedAnnotation).toBeDefined()
  } finally { editor.destroy(); host.remove() }
})
