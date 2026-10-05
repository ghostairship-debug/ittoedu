import type { MotionFrame, MotionKeyframe, MotionTiming } from './types'

/**
 * Uses the same WAAPI lifecycle as PublishedDomInteractionSurfacePort, with
 * additive transform composition instead of replacing the author's endpoint.
 * It never writes inline styles or commitStyles(): live manual frame edits stay
 * underneath the effect and cancelling reveals the current authored frame.
 */
export class DomMotionPresentation {
  readonly #animations = new Set<Animation>()
  readonly #baseOpacity: number
  #transform: Animation | undefined
  #opacity: Animation | undefined

  constructor(readonly element: HTMLElement | SVGElement) {
    const value = element.style.opacity || element.ownerDocument.defaultView?.getComputedStyle(element).opacity || '1'
    const opacity = Number(value)
    this.#baseOpacity = Number.isFinite(opacity) ? opacity : 1
  }

  write(frame: MotionFrame): void {
    if (frame.transform === undefined) {
      this.#remove(this.#transform)
      this.#transform = undefined
    } else {
      this.#transform = this.#hold(this.#transform, { transform: frame.transform }, 'add')
    }
    if (frame.opacity === undefined) {
      this.#remove(this.#opacity)
      this.#opacity = undefined
    } else {
      this.#opacity = this.#hold(this.#opacity, { opacity: frame.opacity * this.#baseOpacity }, 'replace')
    }
  }

  async animate(frames: readonly MotionKeyframe[], timing: MotionTiming): Promise<boolean> {
    this.clear()
    const animations: Animation[] = []
    const metadata = (frame: MotionKeyframe): Keyframe => ({ offset: frame.offset, easing: frame.easing })
    try {
      if (frames.some(frame => frame.transform !== undefined)) {
        animations.push(this.#create(frames.map(frame => ({ ...metadata(frame), transform: frame.transform ?? 'none' })), timing, 'add'))
      }
      if (frames.some(frame => frame.opacity !== undefined)) {
        animations.push(this.#create(frames.map(frame => ({ ...metadata(frame), opacity: (frame.opacity ?? 1) * this.#baseOpacity })), timing, 'replace'))
      }
      const completed = await Promise.all(animations.map(animation => animation.finished.then(() => true, () => false)))
      return completed.every(Boolean)
    } catch (error) {
      this.clear()
      throw error
    }
  }

  clear(): void {
    for (const animation of [...this.#animations]) this.#remove(animation)
    this.#transform = undefined
    this.#opacity = undefined
  }

  #hold(animation: Animation | undefined, frame: Keyframe, composite: CompositeOperation): Animation {
    const frames = [{ ...frame, offset: 0 }, { ...frame, offset: 1 }]
    if (animation) {
      const effect = animation.effect as KeyframeEffect
      effect.setKeyframes(frames)
      return animation
    }
    const held = this.#create(frames, { duration: 1 }, composite)
    held.pause()
    held.currentTime = 0
    return held
  }

  #create(frames: Keyframe[], timing: MotionTiming, composite: CompositeOperation): Animation {
    if (typeof this.element.animate !== 'function') throw new Error('Motion requires Web Animations API on the target document')
    const animation = this.element.animate(frames, { ...timing, composite, fill: 'both' })
    this.#animations.add(animation)
    // A paused frame effect is normally cancelled rather than finished.
    void animation.finished.catch(() => {})
    return animation
  }

  #remove(animation: Animation | undefined): void {
    if (!animation) return
    this.#animations.delete(animation)
    try { animation.cancel() } catch { /* A partial WAAPI implementation must not stop remaining cleanup. */ }
  }
}
