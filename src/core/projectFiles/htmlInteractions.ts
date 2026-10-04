import type { CompositionLayerItem, CourseProjectDocument } from '../../shared/courseProjectTypes'
import type { CourseStateDeclaration } from '../../shared/contracts/course-state/types'
import type { InteractionAction, InteractionCondition, InteractionRule } from '../../shared/interactionTypes'
import { walkComposition } from '../../shared/composition/content'
import type { PageDiagnostic, PageNode } from './pageHtml'

type Element = Extract<PageNode, { kind: 'element' }>
export interface HtmlInteractionPage {
  path: string
  items: readonly CompositionLayerItem[]
  /** Formal HTML anchors to camera stops or other locations of this file. */
  anchors?: ReadonlyMap<string, string>
  locationId: string
  sceneId?: string
}

const PREFIX = 'project-html:'
export const isHtmlInteraction = (rule: InteractionRule) => rule.id.startsWith(PREFIX)

/** Resolve a local URL exactly as a file link. External links remain ordinary browser links. */
export function projectLinkTarget(from: string, href: string): { path: string; anchor?: string } | undefined {
  if (!href || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) return undefined
  const hash = href.indexOf('#')
  const reference = hash < 0 ? href : href.slice(0, hash)
  if (reference.includes('?')) return undefined
  const decoded = (text: string) => { try { return decodeURIComponent(text) } catch { return text } }
  const segments = reference.startsWith('/') ? [] : from.split('/').slice(0, -1)
  for (const part of decoded(reference).split('/')) {
    if (!part || part === '.') continue
    if (part === '..') segments.pop()
    else segments.push(part)
  }
  return { path: reference ? segments.join('/') : from, ...(hash < 0 ? {} : { anchor: decoded(href.slice(hash + 1)) }) }
}

/** Pure mapper; C supplies the same formal composition-node address used by Schema and Player. */
export function mapHtmlInteractions(input: {
  page: HtmlInteractionPage; pages: readonly HtmlInteractionPage[]
  nodeAddress(layerItemId: string, nodeId: string): string
}): { rules: InteractionRule[]; state: CourseStateDeclaration[]; diagnostics: PageDiagnostic[] } {
  const elements: { node: Element; address: string }[] = []
  for (const item of input.page.items) walkComposition(item.content.root, node => {
    if (node.kind === 'element') elements.push({ node, address: input.nodeAddress(item.layerItemId, node.id) })
  })
  const byId = new Map<string, typeof elements>()
  for (const entry of elements) {
    const id = entry.node.attributes.id
    if (id) byId.set(id, [...byId.get(id) ?? [], entry])
  }
  const rules: InteractionRule[] = [], declarations = new Map<string, CourseStateDeclaration>(), diagnostics: PageDiagnostic[] = []
  const add = (source: string, name: string, suffix: string, actions: InteractionAction[], conditions: InteractionCondition[] = []) => {
    const id = `${PREFIX}${source}:${suffix}`
    rules.push({ id, name, enabled: true, trigger: { type: 'node.click', nodeId: source }, conditions,
      actions: actions.map((action, index) => ({ id: `${id}:${index}`, start: 'after-previous', delayMs: 0, action })) })
  }
  const visibility = (source: string, target: typeof elements[number], action: 'show' | 'hide' | 'toggle') => {
    const key = `${PREFIX}visible:${target.address}`
    declarations.set(key, { key, valueType: 'boolean', defaultValue: !Object.hasOwn(target.node.attributes, 'hidden') })
    const set = (visible: boolean): InteractionAction[] => [
      { type: visible ? 'node.enter' : 'node.exit', nodeId: target.address, effect: 'none', durationMs: 0, easing: 'linear' },
      { type: 'course-state.set', key, value: visible },
    ]
    if (action !== 'toggle') add(source, action === 'show' ? '显示内容' : '隐藏内容', action, set(action === 'show'))
    else {
      add(source, '显示内容', 'show', set(true), [{ type: 'course-state.compare', key, operator: 'eq', value: false }])
      add(source, '隐藏内容', 'hide', set(false), [{ type: 'course-state.compare', key, operator: 'eq', value: true }])
    }
  }
  for (const { node, address } of elements) {
    const attrs = node.attributes
    if (node.tagName === 'button' && attrs['aria-controls']) {
      const ids = attrs['aria-controls'].trim().split(/\s+/)
      const targets = ids.map(id => byId.get(id))
      if (targets.length !== 1 || targets[0]?.length !== 1) {
        diagnostics.push({ level: 'warning', code: 'html-interaction-target', message: 'aria-controls 简单切换需要当前文件内一个唯一目标；原 HTML 已保留' })
        continue
      }
      visibility(address, targets[0][0]!, 'toggle')
      continue
    }
    if (node.tagName !== 'a' || !attrs.href || attrs.download !== undefined || attrs.target && attrs.target !== '_self') continue
    const target = projectLinkTarget(input.page.path, attrs.href)
    if (!target) continue
    if (target.path === input.page.path && target.anchor) {
      const candidates = byId.get(target.anchor)
      if (candidates?.length === 1 && Object.hasOwn(candidates[0]!.node.attributes, 'hidden')) {
        visibility(address, candidates[0]!, 'show')
        continue
      }
    }
    const page = input.pages.find(page => page.path === target.path)
    if (!page) {
      if (/^(?:slides(?:-\d+)?|spaces|docs)\//.test(target.path)) diagnostics.push({ level: 'warning', code: 'html-link-pending', message: `链接目标 ${attrs.href} 尚不存在；目标写入后自动接入正式导航` })
      continue
    }
    const locationId = target.anchor ? page.anchors?.get(target.anchor) : page.locationId
    // Ordinary within-document anchors continue to scroll through the browser.
    if (!locationId || target.path === input.page.path && !target.anchor) continue
    add(address, '跳到课程位置', 'go', [{ type: 'location.go', locationId }])
  }
  if (declarations.size) {
    const id = `${PREFIX}${input.page.sceneId ?? input.page.locationId}:reset`
    rules.push({ id, name: '恢复内容初始显示', enabled: true, trigger: { type: 'scene.enter' }, conditions: [],
      actions: [...declarations.values()].map((state, index) => ({ id: `${id}:${index}`, start: 'after-previous', delayMs: 0,
        action: { type: 'course-state.set', key: state.key, value: state.defaultValue } })) })
  }
  return { rules, state: [...declarations.values()], diagnostics }
}

/** Replace only software-derived rules; manual rules and state stay owned by the author. */
export function replaceHtmlInteractionState(project: CourseProjectDocument, mapped: readonly ReturnType<typeof mapHtmlInteractions>[]): void {
  const declarations = new Map(mapped.flatMap(value => value.state.map(state => [state.key, state] as const)))
  const rules = [...project.globalInteractions, ...project.surfaces.flatMap(surface => surface.type === 'slide' ? surface.scenes.flatMap(scene => scene.interactions) : [])]
  project.courseState = project.courseState.filter(state => !state.key.startsWith(`${PREFIX}visible:`) || declarations.has(state.key)
    || rules.some(rule => !isHtmlInteraction(rule) && (rule.conditions.some(condition => 'key' in condition && condition.key === state.key)
      || rule.actions.some(step => step.action.type === 'course-state.set' && step.action.key === state.key))))
  for (const [key, declaration] of declarations) {
    const at = project.courseState.findIndex(state => state.key === key)
    if (at < 0) project.courseState.push(declaration)
    else project.courseState[at] = declaration
  }
}
