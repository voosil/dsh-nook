import { Worker } from 'node:worker_threads'
import { SyncError, type SyncMergeInput, type SyncMergeResult } from '@nook-dsh/capability-sync'

/** One lazy worker per notebook. No Automerge objects cross this boundary. */
export class AutomergeAdapter {
  private worker: Worker | undefined
  private next = 0
  private stopped = false
  private readonly pending = new Map<
    number,
    {
      input: SyncMergeInput
      resolve: (value: SyncMergeResult) => void
      reject: (error: unknown) => void
      cleanup: () => void
    }
  >()
  private start() {
    if (this.worker) return this.worker
    const entry = new URL('./worker.js', import.meta.url).href
    const worker = new Worker(`import(${JSON.stringify(entry)}).then(module => module.listen())`, { eval: true })
    this.worker = worker
    worker.on('message', (message: { id: number; value: SyncMergeResult; error?: string }) => {
      if (this.worker !== worker) return
      const request = this.pending.get(message.id)
      if (!request) return
      this.pending.delete(message.id)
      request.cleanup()
      if (message.error) request.reject(new SyncError(message.error))
      else request.resolve(message.value)
    })
    worker.once('error', error => this.fail(worker, error))
    worker.once('exit', () => this.fail(worker, new SyncError('自动合并工作进程已停止。')))
    return worker
  }
  private cancel(id: number, reason: unknown) {
    const request = this.pending.get(id)
    if (!request) return
    this.pending.delete(id)
    request.cleanup()
    request.reject(reason)
    const worker = this.worker
    this.worker = undefined
    worker?.removeAllListeners()
    if (worker) void worker.terminate()
    // A cancelled sync must not fail an unrelated autosave sharing the worker.
    if (this.pending.size) {
      const next = this.start()
      for (const [pendingId, pending] of this.pending) next.postMessage({ id: pendingId, input: pending.input })
    }
  }
  private fail(worker: Worker, error: unknown) {
    if (this.worker !== worker) return
    this.worker = undefined
    for (const request of this.pending.values()) {
      request.cleanup()
      request.reject(error)
    }
    this.pending.clear()
    worker.removeAllListeners()
    void worker.terminate()
  }
  merge(input: SyncMergeInput, signal: AbortSignal): Promise<SyncMergeResult> {
    signal.throwIfAborted()
    if (this.stopped) return Promise.reject(new SyncError('自动合并已停止。'))
    const worker = this.start()
    const id = ++this.next
    return new Promise((resolve, reject) => {
      const abort = () => this.cancel(id, signal.reason ?? new SyncError('自动合并已取消。'))
      this.pending.set(id, { input, resolve, reject, cleanup: () => signal.removeEventListener('abort', abort) })
      signal.addEventListener('abort', abort, { once: true })
      try {
        worker.postMessage({ id, input })
      } catch (error) {
        this.cancel(id, error)
      }
    })
  }
  async dispose() {
    this.stopped = true
    const worker = this.worker
    if (!worker) return
    this.fail(worker, new SyncError('自动合并已停止。'))
    await worker.terminate()
  }
}
