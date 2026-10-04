// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { parsePageHtml } from '../../src/core/projectFiles/pageHtml'
import { mapHtmlInteractions, projectLinkTarget, type HtmlInteractionPage } from '../../src/core/projectFiles/htmlInteractions'
import { parseWebComposition } from '../../src/main/workbench/htmlImport/parseWebComposition'
import type { CompositionLayerItem } from '../../src/shared/courseProjectTypes'
import { walkComposition } from '../../src/shared/composition/content'
import { PublishedInteractionController } from '../../src/player/interactions/PublishedInteractionController'

function page(html: string): HtmlInteractionPage {
  const parsed = parsePageHtml(html, { parse: parseWebComposition, assets: {} })
  if (parsed.kind !== 'composition') throw new Error('composition')
  const item: CompositionLayerItem = { kind: 'composition', layerItemId: 'page', label: '页面', order: 0, visible: true, locked: false,
    opacity: 1, rotation: 0, hitPolicy: 'auto', playbackInitialVisibility: 'inherit', frame: { mode: 'absolute', x: 0, y: 0, width: 1280, height: 720 }, content: parsed.content }
  return { path: 'slides/01-导入.html', locationId: 'intro', sceneId: 'scene-intro', items: [item] }
}
const address = (layer: string, node: string) => `${layer}/${node}`

describe('project HTML to formal interaction mapper', () => {
  it('resolves ordinary relative, encoded and in-file links while leaving external links alone', () => {
    expect(projectLinkTarget('slides/01-导入.html', '../spaces/%E6%97%85%E7%A8%8B.html#stop')).toEqual({ path: 'spaces/旅程.html', anchor: 'stop' })
    expect(projectLinkTarget('slides/01-导入.html', '02-观察.html')).toEqual({ path: 'slides/02-观察.html' })
    expect(projectLinkTarget('spaces/旅程.html', '#stop')).toEqual({ path: 'spaces/旅程.html', anchor: 'stop' })
    expect(projectLinkTarget('slides/01-导入.html', 'https://example.org')).toBeUndefined()
  })

  it('maps links to location.go and hidden targets to standard motion and boolean state actions, with replay reset', () => {
    const source = page('<a href="02-观察.html">观察</a><a href="#answer">显示答案</a><button aria-controls="answer">切换答案</button><div id="answer" hidden><p>地轴倾斜</p></div>')
    const target = { path: 'slides/02-观察.html', locationId: 'observe', items: [] }
    const mapped = mapHtmlInteractions({ page: source, pages: [source, target], nodeAddress: address })
    expect(mapped.diagnostics).toEqual([])
    expect(mapped.rules[0]!.actions[0]!.action).toEqual({ type: 'location.go', locationId: 'observe' })
    let targetId = ''
    walkComposition(source.items[0]!.content.root, node => { if (node.kind === 'element' && node.attributes.id === 'answer') targetId = address('page', node.id) })
    const enter = mapped.rules.filter(rule => rule.actions[0]!.action.type === 'node.enter')
    const exit = mapped.rules.filter(rule => rule.actions[0]!.action.type === 'node.exit')
    expect(enter).toHaveLength(2)
    expect(exit).toHaveLength(1)
    expect(enter[0]!.actions[0]!.action).toMatchObject({ nodeId: targetId, effect: 'none', durationMs: 0 })
    expect(mapped.state).toEqual([{ key: `project-html:visible:${targetId}`, valueType: 'boolean', defaultValue: false }])
    expect(enter[1]!.conditions).toEqual([{ type: 'course-state.compare', key: mapped.state[0]!.key, operator: 'eq', value: false }])
    expect(exit[0]!.conditions).toEqual([{ type: 'course-state.compare', key: mapped.state[0]!.key, operator: 'eq', value: true }])
    expect(mapped.rules.at(-1)).toMatchObject({ trigger: { type: 'scene.enter' }, actions: [{ action: { type: 'course-state.set', value: false } }] })
  })

  it('keeps unknown targets as ordinary HTML with a local diagnostic, then resolves forward links once written', () => {
    const source = page('<a href="02-观察.html">观察</a><a href="https://example.org">外链</a><a href="#visible">普通锚点</a><p id="visible">阅读</p><button aria-controls="missing">切换</button>')
    const mapped = mapHtmlInteractions({ page: source, pages: [source], nodeAddress: address })
    expect(mapped.rules).toEqual([])
    expect(mapped.diagnostics.map(value => value.code)).toEqual(['html-link-pending', 'html-interaction-target'])
    const later = mapHtmlInteractions({ page: source, pages: [source, { path: 'slides/02-观察.html', locationId: 'observe', items: [] }], nodeAddress: address })
    expect(later.rules[0]!.actions[0]!.action).toEqual({ type: 'location.go', locationId: 'observe' })
  })

  it('executes the mapped toggle twice and navigates through the real Interaction V1 controller', async () => {
    const source = page('<button aria-controls="answer">切换答案</button><div id="answer" hidden>答案</div><a href="02-观察.html">继续</a>')
    const mapped = mapHtmlInteractions({ page: source, pages: [source, { path: 'slides/02-观察.html', locationId: 'observe', items: [] }], nodeAddress: address })
    const state = new Map(mapped.state.map(value => [value.key, value.defaultValue]))
    const clicks = new Map<string, () => void>(), shown = new Map<string, boolean>(), navigated: string[] = [], diagnostics: unknown[] = []
    const controller = new PublishedInteractionController({ surfaceId: 'slide', rules: mapped.rules,
      surface: { bindNodeClick(id, callback) { clicks.set(id, callback); return () => clicks.delete(id) },
        executeNodeMotion(action) { shown.set(action.nodeId, action.type === 'node.enter'); return true } },
      session: { courseState: { get: <T,>(key: string) => state.get(key) as T | undefined, set(key, value) { state.set(key, value as boolean) } },
        currentSceneId: () => source.sceneId!, goToLocation(id) { navigated.push(id); return true }, goToScene: () => true,
        nextScene: () => true, previousScene: () => true, replayScene: () => true, restartCourse: () => true },
      reportDiagnostic: diagnostic => diagnostics.push(diagnostic) })
    const toggle = mapped.rules.find(rule => rule.trigger.type === 'node.click' && rule.conditions.length)!.trigger
    const go = mapped.rules.find(rule => rule.actions[0]!.action.type === 'location.go')!.trigger
    if (toggle.type !== 'node.click' || go.type !== 'node.click') throw new Error('click')
    try {
      clicks.get(toggle.nodeId)!()
      await new Promise(resolve => setTimeout(resolve, 0))
      expect([...shown.values()]).toEqual([true])
      expect([...state.values()]).toEqual([true])
      clicks.get(toggle.nodeId)!()
      await new Promise(resolve => setTimeout(resolve, 0))
      expect([...shown.values()]).toEqual([false])
      expect([...state.values()]).toEqual([false])
      clicks.get(go.nodeId)!()
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(navigated).toEqual(['observe'])
      expect(diagnostics).toEqual([])
    } finally { controller.destroy() }
  })
})
