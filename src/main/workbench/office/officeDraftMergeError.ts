export class OfficeDraftMergeConflict extends Error {
  readonly code = 'office-merge-conflict'
  constructor(readonly location: string, readonly reason: string) {
    super(`Office 并发冲突：${location}。 ${reason}。请用 office.inspect 读取最新草稿并继续本任务。`)
    this.name = 'OfficeDraftMergeConflict'
  }
}
