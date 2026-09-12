import { closeSync, constants, openSync } from 'node:fs'
import { createRequire } from 'node:module'

/** Adapter to the pinned fs-ext dependency already used by the desktop broker. */
export function acquireNativeFileLock(file) {
  const require = createRequire(import.meta.url)
  const dsh = createRequire(require.resolve('@deepseek-ai/dsh/package.json'))
  const base = createRequire(dsh.resolve('@deepseek-ai/dsh-base/package.json'))
  const persistence = createRequire(base.resolve('@deepseek-ai/dsh-session-persistence-jsonl/package.json'))
  const { flockSync } = persistence('fs-ext')
  const fd = openSync(file, constants.O_CREAT | constants.O_RDWR | constants.O_NOFOLLOW, 0o600)
  try {
    flockSync(fd, 'exnb')
  } catch (error) {
    closeSync(fd)
    throw error
  }
  let released = false
  return () => {
    if (released) return
    released = true
    // Closing releases the OS lock even if the process exits without this call.
    // Never unlink the file: competing processes must lock the same inode.
    closeSync(fd)
  }
}
