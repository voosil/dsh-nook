import { spawn } from 'node:child_process'
import { once } from 'node:events'

const URL_PATTERN = /dsh web:\s*(http:\/\/127\.0\.0\.1:\d+)/

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit')
  child.kill('SIGTERM')
  const timeout = new Promise(resolve => {
    const timer = setTimeout(resolve, 5_000, 'timeout')
    timer.unref()
  })
  if ((await Promise.race([exited, timeout])) === 'timeout') {
    child.kill('SIGKILL')
    await exited
  }
}

/** Boot an isolated DSH Profile and verify its rendered Client package set. */
export async function bootAndVerifyWeb({
  bin,
  cwd,
  env,
  profile = 'nook',
  patch,
  timeoutMs = 45_000,
  expectedPackages = ['@nook-dsh/ui-project', '@nook-dsh/ui-sidebar'],
  excludedPackages = [],
}) {
  const args = [bin, '--profile', profile]
  if (patch !== undefined) args.push('--patch', patch)
  args.push('--no-open', '--port', '0')
  const child = spawn(process.execPath, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  let logs = ''

  try {
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`timed out waiting for DSH web runtime\n${logs}`))
      }, timeoutMs)
      timer.unref()
      const consume = chunk => {
        logs = `${logs}${chunk}`.slice(-200_000)
        const match = logs.match(URL_PATTERN)
        if (match?.[1] !== undefined) {
          clearTimeout(timer)
          resolve(match[1])
        }
      }
      child.stdout.on('data', consume)
      child.stderr.on('data', consume)
      child.once('error', error => {
        clearTimeout(timer)
        reject(error)
      })
      child.once('exit', (code, signal) => {
        clearTimeout(timer)
        reject(new Error(`DSH exited before listening (${code ?? signal})\n${logs}`))
      })
    })

    const response = await fetch(`${url}/`)
    const html = await response.text()
    if (!response.ok) throw new Error(`Nook shell returned HTTP ${response.status}`)
    for (const packageName of expectedPackages) {
      if (!html.includes(packageName)) throw new Error(`Nook shell did not load ${packageName}`)
    }
    for (const packageName of excludedPackages) {
      if (html.includes(packageName)) throw new Error(`Nook shell unexpectedly loaded ${packageName}`)
    }
    return { url, status: response.status, html }
  } finally {
    await stop(child)
  }
}
