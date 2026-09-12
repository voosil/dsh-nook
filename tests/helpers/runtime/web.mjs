import { once } from 'node:events'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ProcessScope } from '../../../scripts/shared/process-scope.mjs'
import { ROOT } from '../../../scripts/profile/profile-lib.mjs'

const URL_PATTERN = /dsh web:\s*(http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)(?=\s)/
const redact = logs => logs.replace(/([?&]token=)[^\s&]+/g, '$1<REDACTED>')

/** Start an isolated runtime. The caller selects and owns its acceptance assertions. */
export async function startWebRuntime({
  bin,
  node = process.execPath,
  cwd,
  env,
  profile = 'nook',
  patch,
  timeoutMs = 45_000,
}) {
  const windows = process.platform === 'win32'
  const args = [
    ...(windows ? ['--import', pathToFileURL(join(ROOT, 'apps/desktop/dist/windows-shutdown.mjs')).href] : []),
    bin,
    '--profile',
    profile,
  ]
  if (patch !== undefined) args.push('--patch', patch)
  args.push('--no-open', '--port', '0')
  const processes = new ProcessScope()
  const child = processes.spawn(node, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe', ...(windows ? ['ipc'] : [])],
    windowsHide: true,
  })
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  let logs = ''
  const consume = chunk => {
    logs = `${logs}${chunk}`.slice(-200_000)
  }
  child.stdout.on('data', consume)
  child.stderr.on('data', consume)
  if (windows) child.send({ type: 'start' })

  let disposed = false
  async function dispose() {
    if (disposed) return
    disposed = true

    try {
      if (windows && child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit')
        child.send({ type: 'stop' }, () => {})
        let timer
        try {
          await Promise.race([
            exited,
            new Promise(resolve => {
              timer = setTimeout(resolve, 10_000)
            }),
          ])
        } finally {
          clearTimeout(timer)
        }
      }
      await processes.dispose()
    } finally {
      child.stdout.off('data', consume)
      child.stderr.off('data', consume)
    }
  }

  try {
    const launchUrl = await new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer)
        child.stdout.off('data', ready)
        child.stderr.off('data', ready)
        child.off('error', failed)
        child.off('exit', exited)
      }
      const failed = error => {
        cleanup()
        reject(error)
      }
      const exited = (code, signal) =>
        failed(new Error(`DSH exited before listening (${code ?? signal})\n${redact(logs)}`))
      const timer = setTimeout(
        () => failed(new Error(`timed out waiting for DSH web runtime\n${redact(logs)}`)),
        timeoutMs,
      )
      const ready = () => {
        const match = logs.match(URL_PATTERN)
        if (match?.[1] !== undefined) {
          cleanup()
          resolve(match[1])
        }
      }
      child.stdout.on('data', ready)
      child.stderr.on('data', ready)
      child.once('error', failed)
      child.once('exit', exited)
    })

    return {
      url: new URL(launchUrl).origin,
      launchUrl,
      profileDirectory: join(env.DSH_HOME, 'profiles', profile),
      dispose,
    }
  } catch (error) {
    await dispose()
    throw new Error(redact(String(error)), { cause: error })
  }
}

export async function withWebRuntime(options, callback) {
  const runtime = await startWebRuntime(options)
  try {
    return await callback(runtime.launchUrl, runtime)
  } finally {
    await runtime.dispose()
  }
}
