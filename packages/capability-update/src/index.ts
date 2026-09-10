/** Versioned, JSON-safe update contract. Commands never accept paths or shell text. */
export type UpdatePhase =
  'unavailable' | 'idle' | 'checking' | 'available' | 'preparing' | 'switching' | 'succeeded' | 'failed'
export interface UpdateStatus {
  phase: UpdatePhase
  current: string
  target: string | null
  summary: string | null
  message: string
  task: string | null
}
export type UpdateCommand = 'status' | 'check' | 'start'
export interface UpdateService {
  command(command: UpdateCommand, signal: AbortSignal): Promise<UpdateStatus>
}
export const unavailable: UpdateStatus = {
  phase: 'unavailable',
  current: '',
  target: null,
  summary: null,
  message: '请先从源码运行 pnpm start 以启用应用更新。',
  task: null,
}
