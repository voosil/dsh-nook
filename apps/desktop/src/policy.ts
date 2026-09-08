import { realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path'
import { StringDecoder } from 'node:string_decoder'

export function within(root: string, path: string): boolean {
  const part = relative(root, path)
  return (
    part === '' ||
    (part !== '..' && !part.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(part))
  )
}

export function canonicalPath(path: string): string {
  const missing: string[] = []
  let cursor = resolve(path)
  for (;;) {
    try {
      return resolve(realpathSync(cursor), ...missing.reverse())
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      missing.push(basename(cursor))
      const parent = dirname(cursor)
      if (parent === cursor) throw error
      cursor = parent
    }
  }
}

export function safeHome(path: string, userHome = homedir()): string {
  const home = canonicalPath(path)
  if (within(canonicalPath(resolve(userHome, '.dsh')), home)) throw new Error('Refusing the real DSH home')
  return home
}

export function redact(text: string): string {
  return text.replace(/([?&]token=)[^\s&#"']+/gi, '$1<REDACTED>')
}

export function launchUrl(line: string): string | undefined {
  const match = /^dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[A-Za-z0-9_-]+)\s*$/.exec(line)
  if (!match?.[1]) return undefined
  try {
    const url = new URL(match[1])
    if (!url.port || Number(url.port) === 0 || (url.searchParams.get('token')?.length ?? 0) > 512) return undefined
    return url.href
  } catch {
    return undefined
  }
}

export function sameRuntimeUrl(value: string, origin: string | undefined): boolean {
  try {
    const url = new URL(value)
    return (
      origin !== undefined &&
      url.origin === origin &&
      url.protocol === 'http:' &&
      url.hostname === '127.0.0.1' &&
      !url.username &&
      !url.password
    )
  } catch {
    return false
  }
}

export function externalUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
  } catch {
    return false
  }
}

/** Never emit partial lines: tokens split across chunks must not reach logs. */
export function lineReader(onLine: (line: string) => void, maximum = 16_384) {
  const decoder = new StringDecoder('utf8')
  let pending = ''
  let dropping = false
  const consume = (text: string) => {
    for (const part of text.split(/(?<=\n)/)) {
      if (!dropping) pending += part
      if (pending.length > maximum) {
        pending = ''
        dropping = true
      }
      if (part.endsWith('\n')) {
        onLine(dropping ? '[oversized runtime log line omitted]' : pending.trimEnd())
        pending = ''
        dropping = false
      }
    }
  }
  return {
    write: (chunk: Buffer) => consume(decoder.write(chunk)),
    end: () => {
      consume(decoder.end())
      if (pending || dropping) onLine(dropping ? '[oversized runtime log line omitted]' : pending)
      pending = ''
      dropping = false
    },
  }
}

export function runtimeEnvironment(home: string, nodeDirectory: string): NodeJS.ProcessEnv {
  const env = { ...process.env }
  for (const key of [
    'ELECTRON_RUN_AS_NODE',
    'NODE_OPTIONS',
    'NODE_PATH',
    'NOOK_DESKTOP_TEST_ROOT',
    'NOOK_DESKTOP_DEV_CONFIG',
  ])
    delete env[key]
  return {
    ...env,
    PATH: `${nodeDirectory}${process.platform === 'win32' ? ';' : ':'}${env.PATH ?? ''}`,
    DSH_HOME: safeHome(home),
    DSH_AGENTS_HOME: resolve(home, 'agents'),
    DSH_TELEMETRY_DISABLED: '1',
    CHOKIDAR_USEPOLLING: '1',
    NO_COLOR: '1',
  }
}
