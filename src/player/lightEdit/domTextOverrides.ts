import {
  lightEditOverrideKey,
  normalizeLightEditText,
  type LightEditTextOverride,
} from '../../shared/contracts/runtime/lightEdit'

/** Elements whose text is not visible page copy, or is typed by the viewer. */
const SKIPPED_SELECTOR = 'script,style,noscript,template,textarea,option,title,[contenteditable]:not([contenteditable="false"])'
const MAX_REGION_DEPTH = 4
const LIVE_TEXT_WINDOW_MS = 5_000
const LIVE_TEXT_CHANGES = 3

/**
 * Text the program computes (scores, timers, counters) is edited through AI only (M15):
 * text without any letter, or text the Runtime rewrote several times within a few seconds.
 */
export function isLiveComputedText(original: string, writes: readonly number[]): boolean {
  if (!/\p{L}/u.test(original)) return true
  return writes.length >= LIVE_TEXT_CHANGES && writes[writes.length - 1]! - writes[writes.length - LIVE_TEXT_CHANGES]! <= LIVE_TEXT_WINDOW_MS
}

/** Keeps the last few Runtime write times of one text. */
export function recordTextWrite(writes: number[]): void {
  writes.push(Date.now())
  if (writes.length > LIVE_TEXT_CHANGES) writes.splice(0, writes.length - LIVE_TEXT_CHANGES)
}

/** Where a text node renders: the tag path of its nearest ancestors inside `root`. */
export function domTextRegion(node: Text, root: Node): string {
  const tags: string[] = []
  for (let element = node.parentElement; element && element !== root && tags.length < MAX_REGION_DEPTH; element = element.parentElement) {
    tags.unshift(element.localName)
  }
  return tags.length ? tags.join('>') : 'root'
}

function skipped(node: Text): boolean {
  return Boolean(node.parentElement?.closest(SKIPPED_SELECTOR))
}

/** The rule for one occurrence: a region-specific rule wins over one that applies everywhere. */
export function matchLightEditRule(
  rules: ReadonlyMap<string, LightEditTextOverride>,
  original: string,
  region: string,
): LightEditTextOverride | undefined {
  return rules.get(lightEditOverrideKey({ original, region }))
    ?? rules.get(lightEditOverrideKey({ original }))
}

export function lightEditRuleMap(rules: readonly LightEditTextOverride[]): Map<string, LightEditTextOverride> {
  return new Map(rules.map(rule => [lightEditOverrideKey(rule), rule]))
}

/** Keep the author's surrounding whitespace so inline layout does not shift. */
function padded(raw: string, text: string): string {
  const leading = /^\s*/.exec(raw)?.[0] ?? ''
  const trailing = raw.length > leading.length ? /\s*$/.exec(raw)?.[0] ?? '' : ''
  return leading + text + trailing
}

interface TextRecord {
  /** Text as the Runtime wrote it. */
  raw: string
  /** Value this host last wrote, or null when showing `raw`. */
  applied: string | null
  /** Times the Runtime rewrote this node, newest last. */
  writes: number[]
}

export interface DomTextSample {
  readonly node: Text
  readonly root: Node
  /** Normalized text the Runtime rendered, before any rule. */
  readonly original: string
  readonly region: string
  /** Normalized text on screen now. */
  readonly shown: string
  readonly rule: LightEditTextOverride | undefined
  /** Program-computed text that is not offered for direct editing. */
  readonly live: boolean
}

/**
 * Applies light-edit rules to text a Runtime or Component renders into its DOM roots.
 * The Runtime keeps writing its own text; this host rewrites matching nodes after every
 * change and restores the Runtime's text when a rule is removed, so undo stays exact.
 */
export class DomTextOverrides {
  private readonly records = new WeakMap<Text, TextRecord>()
  private readonly observers: MutationObserver[] = []
  private rules: Map<string, LightEditTextOverride>
  private destroyed = false

  constructor(
    private readonly roots: readonly Node[],
    rules: readonly LightEditTextOverride[],
    private readonly onChange?: () => void,
  ) {
    this.rules = lightEditRuleMap(rules)
    if (typeof MutationObserver === 'undefined') return
    for (const root of roots) {
      const observer = new MutationObserver((mutations) => this.handle(root, mutations))
      observer.observe(root, { subtree: true, childList: true, characterData: true })
      this.observers.push(observer)
    }
  }

  /** Hot update: re-evaluate every rendered text against the new rules. */
  setRules(rules: readonly LightEditTextOverride[]): void {
    if (this.destroyed) return
    this.rules = lightEditRuleMap(rules)
    this.applyAll()
  }

  /** Apply rules to everything rendered so far (after create(), before the first observer tick). */
  applyAll(): void {
    if (this.destroyed) return
    let changed = false
    for (const root of this.roots) {
      for (const node of this.textNodes(root)) changed = this.process(node, root) || changed
    }
    if (changed) this.onChange?.()
  }

  samples(): DomTextSample[] {
    const samples: DomTextSample[] = []
    for (const root of this.roots) {
      for (const node of this.textNodes(root)) {
        const record = this.record(node)
        const original = normalizeLightEditText(record.raw)
        if (!original) continue
        const region = domTextRegion(node, root)
        samples.push({
          node, root, original, region,
          shown: normalizeLightEditText(node.nodeValue ?? ''),
          rule: matchLightEditRule(this.rules, original, region),
          live: isLiveComputedText(original, record.writes),
        })
      }
    }
    return samples
  }

  destroy(): void {
    this.destroyed = true
    this.observers.forEach(observer => observer.disconnect())
    this.observers.length = 0
  }

  private handle(root: Node, mutations: readonly MutationRecord[]): void {
    if (this.destroyed) return
    let changed = false
    for (const mutation of mutations) {
      if (mutation.type === 'characterData' && mutation.target.nodeType === 3) {
        changed = this.process(mutation.target as Text, root) || changed
      } else if (mutation.type === 'childList') {
        mutation.addedNodes.forEach((added) => {
          if (added.nodeType === 3) changed = this.process(added as Text, root) || changed
          else for (const node of this.textNodes(added)) changed = this.process(node, root) || changed
        })
      }
    }
    if (changed) this.onChange?.()
  }

  private *textNodes(root: Node): Generator<Text> {
    const document = root.ownerDocument ?? (root as Document)
    const walker = document.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!skipped(node as Text)) yield node as Text
    }
  }

  private record(node: Text): TextRecord {
    const current = node.nodeValue ?? ''
    const known = this.records.get(node)
    // Anything other than our own last write is the Runtime writing new text.
    if (known && current === (known.applied ?? known.raw)) return known
    const fresh: TextRecord = { raw: current, applied: null, writes: known?.writes ?? [] }
    if (known) recordTextWrite(fresh.writes)
    this.records.set(node, fresh)
    return fresh
  }

  /** Returns whether the node now shows something different. */
  private process(node: Text, root: Node): boolean {
    if (skipped(node)) return false
    const record = this.record(node)
    const original = normalizeLightEditText(record.raw)
    const rule = original ? matchLightEditRule(this.rules, original, domTextRegion(node, root)) : undefined
    const desired = rule ? padded(record.raw, rule.text) : record.raw
    record.applied = rule ? desired : null
    if (node.nodeValue === desired) return false
    node.nodeValue = desired
    return true
  }
}
