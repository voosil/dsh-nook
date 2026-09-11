import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { taskSmoke } from './task-smoke.mjs'
import { notebookSmoke } from './notebook-smoke.mjs'

const URL_PATTERN = /dsh web:\s*(http:\/\/127\.0\.0\.1:\d+\/\?token=[^\s]+)(?=\s)/
const redact = logs => logs.replace(/([?&]token=)[^\s&]+/g, '$1<REDACTED>')

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
  expectedPackages = [
    '@nook-dsh/ui-project',
    '@nook-dsh/ui-sidebar',
    '@nook-dsh/ui-notes',
    '@nook-dsh/ui-knowledge',
    '@nook-dsh/ui-tasks',
  ],
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
    const launchUrl = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`timed out waiting for DSH web runtime\n${redact(logs)}`))
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
        reject(new Error(`DSH exited before listening (${code ?? signal})\n${redact(logs)}`))
      })
    })

    const url = new URL(launchUrl).origin
    const exchange = await fetch(launchUrl, { redirect: 'manual' })
    const cookie = exchange.headers.get('set-cookie')?.split(';', 1)[0]
    if (exchange.status !== 303 || !cookie) throw new Error('DSH launch URL did not establish browser authentication')
    const response = await fetch(`${url}/`, { headers: { cookie } })
    const html = await response.text()
    if (!response.ok) throw new Error(`Nook shell returned HTTP ${response.status}`)
    for (const packageName of expectedPackages) {
      if (!html.includes(packageName)) throw new Error(`Nook shell did not load ${packageName}`)
    }
    for (const packageName of excludedPackages) {
      if (html.includes(packageName)) throw new Error(`Nook shell unexpectedly loaded ${packageName}`)
    }
    if (expectedPackages.includes('@nook-dsh/ui-tasks')) await taskSmoke(launchUrl)
    if (expectedPackages.includes('@nook-dsh/ui-notes')) await notebookSmoke(launchUrl, undefined, undefined, true)
    return { url, status: response.status, html }
  } finally {
    await stop(child)
  }
}
