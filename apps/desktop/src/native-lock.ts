import { closeSync, constants, openSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

/** Adapter to the pinned standard-Node fs-ext dependency verified in DSH's manifest. */
export function claimRuntime(state: string, profile: string): (() => void) | undefined {
  const require = createRequire(join(profile, 'package.json'))
  const base = createRequire(require.resolve('@deepseek-ai/dsh-base/package.json'))
  const persistence = createRequire(base.resolve('@deepseek-ai/dsh-session-persistence-jsonl/package.json'))
  const { flockSync } = persistence('fs-ext') as { flockSync(fd: number, operation: string): void }
  const fd = openSync(join(state, 'runtime.lock'), constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600)
  try {
    flockSync(fd, 'exnb')
  } catch (error) {
    closeSync(fd)
    if (['EAGAIN', 'EWOULDBLOCK'].includes((error as NodeJS.ErrnoException).code ?? '')) return undefined
    throw error
  }
  let released = false
  return () => {
    if (released) return
    released = true
    try {
      flockSync(fd, 'un')
    } finally {
      closeSync(fd)
    }
  }
}
