import type { CoursePublishSources } from '../../src/renderer/export/course/buildPublishedCourse'
import { createBlankCourseProject } from '../../src/core/course/createCourseProject'
import { parseComponentPackageFiles } from '../../src/core/drivers/codecs/importComponentPackage'
import { componentPackageMeta } from '../../src/shared/componentPackageMeta'
import { planProjectFontImport } from '../../src/renderer/course/projectFontImport'
import { courseProjectDocumentSchema } from '../../src/shared/courseProjectSchema'

export async function createProjectFontDeliveryFixture(fontBytes: Uint8Array, fallbackBytes: Uint8Array): Promise<CoursePublishSources> {
  const imported = await planProjectFontImport(createBlankCourseProject(), 'lesson.woff2', fontBytes)
  const project = structuredClone(imported.transaction.nextDocument)
  const fontId = imported.assetId
  const assetFiles = { [fontId]: fontBytes, 'fallback-image': fallbackBytes, 'unused-font': fontBytes }
  const audio = new Uint8Array(844)
  const audioView = new DataView(audio.buffer)
  const ascii = (offset: number, text: string) => { for (let i = 0; i < text.length; i++) audio[offset + i] = text.charCodeAt(i) }
  ascii(0, 'RIFF'); audioView.setUint32(4, audio.length - 8, true); ascii(8, 'WAVE'); ascii(12, 'fmt ')
  audioView.setUint32(16, 16, true); audioView.setUint16(20, 1, true); audioView.setUint16(22, 1, true)
  audioView.setUint32(24, 8000, true); audioView.setUint32(28, 8000, true); audioView.setUint16(32, 1, true); audioView.setUint16(34, 8, true)
  ascii(36, 'data'); audioView.setUint32(40, 800, true); audio.fill(128, 44)
  assetFiles['direct-audio'] = audio
  project.assets['direct-audio'] = { id: 'direct-audio', kind: 'audio', filename: 'tone.wav', mimeType: 'audio/wav', path: 'assets/tone.wav', byteLength: audio.length, duration: .1 }
  project.assets['unused-font'] = { ...project.assets[fontId]!, id: 'unused-font', path: 'assets/unused.woff2' }
  project.assets['fallback-image'] = { id: 'fallback-image', kind: 'image', filename: 'fallback.png', mimeType: 'image/png', path: 'assets/fallback.png', byteLength: fallbackBytes.length, width: 1, height: 1 }
  const body = (name: string, accessor: string) => {
    const projectUrl = name === 'ComponentFont' ? 'ctx.projectAssetUrl' : 'ctx.assets.projectUrl'
    return `var alive=true;var face=new FontFace('${name}','url('+${accessor}+')');var ready=face.load().then(function(){if(!alive)return;document.fonts.add(face);ctx.dom.root.style.cssText='padding:24px;color:#142e48;font:32px ${name}';var label=document.createElement('div');label.textContent='${name} loaded';ctx.dom.root.appendChild(label);ctx.dom.root.setAttribute('data-font-loaded','${name}');var img=document.createElement('img');img.src=${projectUrl}('fallback-image');img.setAttribute('data-direct-image','${name}');ctx.dom.root.appendChild(img);var audio=document.createElement('audio');audio.src=${projectUrl}('direct-audio');audio.preload='metadata';audio.setAttribute('data-direct-audio','${name}');ctx.dom.root.appendChild(audio)});return {prepareCapture(){return ready},destroy(){alive=false;document.fonts.delete(face)}}`
  }
  const runtimeSource = `CoursewareComponent.define({id:'font-demo',runtimeApiVersion:4,create(ctx){${body('ComponentFont', `ctx.projectAssetUrl('${fontId}')`)}}})`
  const manifest = { schemaVersion: 4, runtimeApiVersion: 4, id: 'font-demo', name: 'Font demo', version: '1.0.0', entry: 'runtime.js',
    defaultSize: { width: 500, height: 180 }, minSize: { width: 100, height: 80 }, preserveAspectRatio: false,
    assets: {}, defaultProps: {}, supportedScopes: ['scene'], renderMode: 'dom', editor: { properties: [] } }
  const files = { 'manifest.json': new TextEncoder().encode(JSON.stringify(manifest)), 'runtime.js': new TextEncoder().encode(runtimeSource) }
  const component = parseComponentPackageFiles(files)
  if (!component.contentSha256) throw new Error('Parsed component identity missing')
  project.componentPackages[manifest.id] = componentPackageMeta(component)
  const slide = project.surfaces.find(surface => surface.type === 'slide')!
  if (slide.type !== 'slide') throw new Error('Slide fixture missing')
  const common = { visible: true, locked: false, rotation: 0, opacity: 1, hitPolicy: 'auto' as const, playbackInitialVisibility: 'inherit' as const }
  slide.scenes[0]!.layerItems.push({ ...common, layerItemId: 'component-font', label: 'Component font', order: 1,
    frame: { mode: 'absolute', x: 40, y: 60, width: 500, height: 180 }, kind: 'component',
    component: { packageId: manifest.id, version: manifest.version }, props: {}, staticFallbackAssetId: 'fallback-image' })
  slide.scenes[0]!.layerItems.push({ ...common, layerItemId: 'runtime-font', label: 'Runtime font', order: 2,
    frame: { mode: 'absolute', x: 40, y: 300, width: 500, height: 180 }, kind: 'runtime', runtime: {
      protocol: 'canvas-runtime', runtimeApiVersion: 2, enabled: true, renderMode: 'dom',
      source: `CoursewareRuntime.define({runtimeApiVersion:2,create(ctx){${body('RuntimeFont', `ctx.assets.projectUrl('${fontId}')`)}}})`,
      content: { values: {} }, assets: {}, staticFallback: { assetId: 'fallback-image', coverage: 'scene' },
    } })
  return { project: courseProjectDocumentSchema.parse(project), assetFiles, components: { [manifest.id]: component } }
}
