export const apiVersion = 2

export default async function build({ api, documents, encodeBase64 }) {
  if (!documents.teachingPlan.content.includes('分母') || !documents.presentationScript.content.includes('无限画布')) throw new Error('缺少已确认教学输入')
  const session = await api.createCourseProject({ surfaceType: 'slide', title: '分数：从整体到份数' })
  const append = async (tool, input, parent = { kind: 'owner' }, insertion = { kind: 'append' }) => {
    const scope = await session.createScope({ parent, insertion })
    const receipt = await session.execute(tool, input, { kind: 'create', scope })
    if (receipt.status !== 'committed') throw new Error(`${receipt.requestId} ${tool}: ${JSON.stringify(receipt.diagnostics)}`)
    return receipt
  }
  const active = async owner => {
    const snapshot = await session.observe()
    return session.activateScope({ locationId: snapshot.scope.locationId, owner, stateId: null })
  }
  await append('native.content', { operation: 'insert', template: { nativeType: 'text', text: '把一个整体平均分成若干份，分母表示总份数，分子表示所取份数。', x: 60, y: 70, width: 1100, height: 130 } })
  await active('global')
  const fallback = await append('asset.media.import', { kind: 'image', filename: 'fraction.svg', mimeType: 'image/svg+xml',
    base64: encodeBase64('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="220"><rect width="600" height="220" fill="#e0f2fe"/><text x="50" y="130" font-size="48" fill="#075985">1/2 → 1/4</text></svg>') })
  await active('scene')
  const manifest = { schemaVersion: 4, runtimeApiVersion: 4, id: 'fraction-toggle', name: '分数观察', version: '1.0.0', entry: 'runtime.js',
    defaultSize: { width: 600, height: 220 }, minSize: { width: 300, height: 120 }, preserveAspectRatio: false, assets: {}, defaultProps: {}, supportedScopes: ['scene'], renderMode: 'dom', editor: { properties: [] } }
  const source = `CoursewareComponent.define({id:'fraction-toggle',runtimeApiVersion:4,create(ctx){
    var button=document.createElement('button');var denominator=2;
    button.style.cssText='width:100%;height:100%;border:0;border-radius:16px;background:#075985;color:white;font:36px sans-serif';
    function render(){button.textContent='1/'+denominator+' · 点击改变总份数'}render();
    button.onclick=function(){denominator=denominator===2?4:2;render()};ctx.dom.root.appendChild(button);
    return {destroy(){button.onclick=null;button.remove()}};
  }})`
  await append('component.insert', { operation: 'candidate', staticFallbackAssetId: fallback.affected[0].id,
    files: { 'manifest.json': encodeBase64(JSON.stringify(manifest)), 'runtime.js': encodeBase64(source) } })
  const current = await session.observe()
  await append('recipe.apply', { recipeId: 'choice-feedback-v1', slots: { title: '分母表示什么？', options: '所取份数\n平均分的总份数', correct: '2', success: '正确：分母表示平均分的总份数。', failure: '再看定义：分子才表示所取份数。' } },
    { kind: 'course-locations' }, { kind: 'after', siblingId: current.scope.locationId })
  await active('global')
  await append('course.navigation', { operation: 'add-surface', surfaceType: 'flow', title: '分数复习讲义' }, { kind: 'course-locations' })
  const flowSnapshot = await session.observe({ includeContent: true })
  const flowHeading = flowSnapshot.items.find(item => item.type === 'heading')
  const headingReceipt = await session.execute('flow.content', { operation: 'replace', block: { ...flowHeading, content: { inlines: [{ type: 'text', text: '分数复习讲义' }] } } },
    { kind: 'update', target: flowSnapshot.targets.content.find(target => target.itemId === flowHeading.id) })
  if (headingReceipt.status !== 'committed') throw new Error(JSON.stringify(headingReceipt))
  await append('flow.content', { operation: 'insert', block: { type: 'paragraph', content: { inlines: [{ type: 'text', text: '分母表示平均分的总份数；分子表示所取份数。' }] } } }, { kind: 'flow-body', parentBlockId: null })
  await append('flow.content', { operation: 'insert', block: { type: 'table', columns: [{ id: 'fraction', header: { inlines: [{ type: 'text', text: '分数' }] } }, { id: 'meaning', header: { inlines: [{ type: 'text', text: '含义' }] } }], rows: [
    { id: 'half', cells: { fraction: { inlines: [{ type: 'text', text: '1/2' }] }, meaning: { inlines: [{ type: 'text', text: '平均分成两份，取一份' }] } } }, { id: 'quarter', cells: { fraction: { inlines: [{ type: 'text', text: '1/4' }] }, meaning: { inlines: [{ type: 'text', text: '平均分成四份，取一份' }] } } },
  ] } }, { kind: 'flow-body', parentBlockId: null })
  await active('global')
  await append('course.navigation', { operation: 'add-surface', surfaceType: 'spatial-2d', title: '分数关系图' }, { kind: 'course-locations' })
  const half = await append('native.content', { operation: 'insert', template: { nativeType: 'text', text: '1/2：整体平均分成两份', x: 80, y: 160, width: 420, height: 100 } })
  const quarter = await append('native.content', { operation: 'insert', template: { nativeType: 'text', text: '1/4：整体平均分成四份', x: 720, y: 160, width: 420, height: 100 } })
  await append('spatial.structure', { operation: 'add-path', path: { name: '观察两种分数', layerItemIds: [half.affected[0].id, quarter.affected[0].id] } })
  await append('spatial.structure', { operation: 'add-relation', relation: { sourceLayerItemId: half.affected[0].id, targetLayerItemId: quarter.affected[0].id, kind: 'arrow' } })
  await append('spatial.structure', { operation: 'add-camera', pose: { x: 280, y: 210, zoom: 1.2 }, name: '观察二分之一' }, { kind: 'course-locations' })
  return await session.finish()
}
