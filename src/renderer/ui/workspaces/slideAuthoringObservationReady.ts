import { PublishedCaptureBarrier } from '../../../player/surfaces/publishedCapture'

/** Tracks only the existing Published command queue for the mounted generation;
 * it owns no document, command order, revision or authoring history. */
export class SlideAuthoringObservationReady {
  #generation: object | null = null
  #barrier = new PublishedCaptureBarrier()

  begin(generation: object): void {
    this.#barrier.destroy()
    this.#barrier = new PublishedCaptureBarrier()
    this.#generation = generation
  }

  track(generation: object, work: Promise<unknown>): void {
    if (generation === this.#generation) this.#barrier.waitUntil(work)
  }

  end(generation: object): void {
    if (generation !== this.#generation) return
    this.#generation = null
    this.#barrier.destroy()
  }

  async waitForReady(generation: object): Promise<void> {
    const assertCurrent = () => {
      if (generation !== this.#generation) throw new Error('当前 Slide 画布世代尚未同步或已经失效')
    }
    assertCurrent()
    const barrier = this.#barrier
    await barrier.waitForReady()
    assertCurrent()
  }
}
