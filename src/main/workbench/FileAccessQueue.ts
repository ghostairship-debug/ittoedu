/** Concurrent reads/saves; physical file operations hold the exclusive side. */
export class FileAccessQueue {
  private readers = 0
  private writing = false
  private pending: { exclusive: boolean; start(): void }[] = []

  run<T>(exclusive: boolean, work: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pending.push({ exclusive, start: () => {
        if (exclusive) this.writing = true
        else this.readers++
        Promise.resolve().then(work).then(resolve, reject).finally(() => {
          if (exclusive) this.writing = false
          else this.readers--
          this.pump()
        })
      } })
      this.pump()
    })
  }
  private pump() {
    if (this.writing) return
    while (this.pending.length) {
      if (this.pending[0].exclusive) {
        if (!this.readers) this.pending.shift()!.start()
        return
      }
      this.pending.shift()!.start()
    }
  }
}
