import { parentPort } from 'node:worker_threads'
import type { SyncMergeInput } from '@nook-dsh/capability-sync'
import { MergeAlgorithm } from './algorithm.js'

/** Explicit worker entry; importing this module registers no listeners. */
export function listen() {
  if (!parentPort) throw new Error('Merge worker requires a parent port')
  const port = parentPort
  const algorithm = new MergeAlgorithm()
  const message = ({ id, input }: { id: number; input: SyncMergeInput }) => {
    try {
      port.postMessage({ id, value: algorithm.merge(input) })
    } catch {
      port.postMessage({ id, error: '自动合并未完成，原始版本已保留，请重试。' })
    }
  }
  port.on('message', message)
  port.once('close', () => port.off('message', message))
}
