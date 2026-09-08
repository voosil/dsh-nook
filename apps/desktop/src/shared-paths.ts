import { createHash } from 'node:crypto'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { canonicalPath, safeHome, within } from './policy.js'

export function userState(): string {
  const base =
    process.platform === 'darwin'
      ? join(homedir(), 'Library/Application Support')
      : process.platform === 'win32'
        ? (process.env.APPDATA ?? join(homedir(), 'AppData/Roaming'))
        : (process.env.XDG_DATA_HOME ?? join(homedir(), '.local/share'))
  return canonicalPath(join(base, 'Nook'))
}

/** Only explicit test mode may override the formal user directory. */
export function testState(path: string): string {
  const state = canonicalPath(path)
  if (!within(canonicalPath(tmpdir()), state) && !within(canonicalPath('/private/tmp'), state))
    throw new Error('Nook verification requires a temporary directory')
  return state
}

export function runtimeSocket(state: string): string {
  safeHome(join(state, 'harness'))
  const key = createHash('sha256').update(canonicalPath(state)).digest('hex').slice(0, 32)
  // A short path avoids macOS's Unix-domain socket path limit, including CJK homes.
  return process.platform === 'win32' ? `\\\\.\\pipe\\nook-${key}` : `/tmp/nook-${process.getuid!()}-${key}.sock`
}
