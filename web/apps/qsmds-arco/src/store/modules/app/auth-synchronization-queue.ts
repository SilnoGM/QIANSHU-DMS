type AsyncTask = () => Promise<void>
type AuthSynchronizationTask = (
  broadcastSessionInvalid: boolean,
) => Promise<void>

/**
 * 串行处理只关心“最新版本”的异步任务。
 *
 * 新版本在旧任务执行期间到达时，旧 Promise 会继续 drain 到最新版本；任务失败时
 * 保留未完成版本，下一次请求可以用同一版本重试。若失败任务已经被更高版本取代，
 * 则直接尝试最新版本，避免把已到达的认证事件丢在一个刚结束的 Promise 后面。
 */
export class LatestVersionTaskQueue {
  private completedVersion = 0
  private requestedVersion = 0
  private runningPromise: Promise<void> | null = null

  constructor(private readonly task: AsyncTask) {}

  get hasPending(): boolean {
    return this.requestedVersion > this.completedVersion
  }

  request(version: number): Promise<void> {
    this.requestedVersion = Math.max(this.requestedVersion, version)
    if (!this.hasPending) {
      return Promise.resolve()
    }
    if (this.runningPromise === null) {
      // 先保存 Promise，再在 microtask 中调用 task，阻止 task 同步回调 request 时
      // 误判当前没有 drain 而启动第二条并行链。
      this.runningPromise = Promise.resolve().then(() => this.drain())
    }
    return this.runningPromise
  }

  private async drain(): Promise<void> {
    try {
      while (this.hasPending) {
        const versionToProcess = this.requestedVersion
        try {
          await this.task()
          this.completedVersion = versionToProcess
        }
        catch (error) {
          if (this.requestedVersion > versionToProcess) {
            // 更高版本代表更新的服务端事实；旧任务失败不能吞掉已到达的新事件。
            continue
          }
          throw error
        }
      }
    }
    finally {
      // 在 drain Promise settlement 前同步清空，消除外置 finally 造成的丢唤醒窗口。
      this.runningPromise = null
    }
  }
}

/**
 * BroadcastChannel/pageshow 共用的认证同步队列。
 *
 * 同一轮开始前的事件可以合并；一旦 `/me` 已经发出，后到事件必须追加一轮，才能
 * 保证 logout 后紧接 login 等状态迁移最终以最新 Cookie 为准。
 */
export class AuthSynchronizationQueue {
  private eventVersion = 0
  private pendingBroadcastSessionInvalid = false
  private readonly queue: LatestVersionTaskQueue

  constructor(private readonly synchronize: AuthSynchronizationTask) {
    this.queue = new LatestVersionTaskQueue(() => this.synchronizeOnce())
  }

  request(broadcastSessionInvalid: boolean): Promise<void> {
    this.eventVersion += 1
    this.pendingBroadcastSessionInvalid ||= broadcastSessionInvalid
    return this.queue.request(this.eventVersion)
  }

  private async synchronizeOnce(): Promise<void> {
    const broadcastSessionInvalid = this.pendingBroadcastSessionInvalid
    this.pendingBroadcastSessionInvalid = false
    try {
      await this.synchronize(broadcastSessionInvalid)
    }
    catch (error) {
      // 失败未得到确定 Session 结论；保留较强策略供下一事件触发的重试使用。
      this.pendingBroadcastSessionInvalid ||= broadcastSessionInvalid
      throw error
    }
  }
}
