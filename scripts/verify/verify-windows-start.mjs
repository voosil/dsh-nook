import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { ROOT, exists } from '../profile/profile-lib.mjs'
import { SharedRuntime, sharedRuntimeRunning } from '../../apps/desktop/dist/shared-client.mjs'
import { verifyBackup } from '../../packages/storage-backup/lib/index.js'
import { notebookSmoke } from './notebook-smoke.mjs'

if (process.platform !== 'win32') throw new Error('Run this acceptance on Windows')
const state = await mkdtemp(join(tmpdir(), 'nook Windows 验收 '))
const children = new Set()
let peer
let succeeded = false
const redact = text => text.replace(/([?&]token=)[^\s&#]+/g, '$1<REDACTED>')

async function launch(port) {
  const args = ['--test-state', state, ...(port === undefined ? [] : ['--port', port])]
  const child = fork(join(ROOT, 'scripts/profile/start-profile.mjs'), args, {
    cwd: ROOT,
    execArgv: ['--import', pathToFileURL(join(ROOT, 'apps/desktop/dist/windows-shutdown.mjs')).href],
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
    env: { ...process.env, DSH_HOME: join(state, 'harness'), DSH_TELEMETRY_MODE: 'DISABLED' },
  })
  children.add(child)
  child.once('exit', () => children.delete(child))
  child.send({ type: 'start' })
  let logs = ''
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Startup timeout\n${redact(logs)}`)), 600_000)
    const consume = chunk => {
      logs = (logs + chunk.toString()).slice(-80_000)
      const match = /dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=[\w-]+)\s/.exec(logs)
      if (match) {
        clearTimeout(timer)
        resolve(match[1])
      }
    }
    for (const stream of [child.stdout, child.stderr]) stream.on('data', consume)
    child.once('error', error => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('exit', code => {
      clearTimeout(timer)
      for (const stream of [child.stdout, child.stderr]) stream.off('data', consume)
      reject(new Error(`Start exited ${code}\n${redact(logs)}`))
    })
  })
  return { child, url }
}

async function close(child) {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit')
  child.send({ type: 'stop' }, () => {})
  const timer = setTimeout(() => child.kill('SIGKILL'), 20_000)
  try {
    await exited
  } finally {
    clearTimeout(timer)
  }
  assert.equal(child.exitCode, 0, 'launcher must exit cleanly')
}

try {
  console.log(`Windows start acceptance uses disposable state: ${state}`)
  const first = await launch()
  console.log('First start: authenticated URL received from a clean packed Profile.')
  const origin = new URL(first.url).origin
  assert.equal((await fetch(origin)).status, 401)
  const exchange = await fetch(first.url, { redirect: 'manual' })
  assert.equal(exchange.status, 303)
  const cookie = exchange.headers.get('set-cookie').split(';', 1)[0]
  const html = await (await fetch(origin, { headers: { cookie } })).text()
  for (const name of ['ui-notes', 'ui-knowledge', 'ui-project', 'ui-sidebar'])
    assert.ok(html.includes(`@nook-dsh/${name}`))
  await mkdir(join(ROOT, '.pack'), { recursive: true })
  await notebookSmoke(first.url, join(ROOT, '.pack/windows-start.png'), undefined, true)
  console.log('Browser acceptance: project/note create, save, reload, recycle, restore and sync passed.')
  peer = new SharedRuntime(
    state,
    async () => {
      throw new Error('Existing backend must be reused')
    },
    () => {},
    () => {},
  )
  assert.equal(await peer.ready, first.url)
  await close(first.child)
  assert.equal((await fetch(origin, { headers: { cookie } })).status, 200)
  await peer.stop()
  peer = undefined
  assert.equal(await sharedRuntimeRunning(state), false)
  await assert.rejects(fetch(origin, { signal: AbortSignal.timeout(1000) }))
  assert.equal(await exists(join(state, 'harness/nook.lock')), false)
  console.log('Shared leases and final process/lock shutdown passed.')
  const second = await launch(new URL(first.url).port)
  const backups = await readdir(join(state, 'backups'))
  const complete = backups.filter(name => !name.startsWith('.'))
  assert.ok(complete.length)
  for (const name of complete) verifyBackup(join(state, 'backups', name))
  assert.equal((await fetch(new URL(second.url).origin, { headers: { cookie } })).status, 200)
  await close(second.child)
  for (let i = 0; i < 100 && (await sharedRuntimeRunning(state)); i++) await delay(100)
  assert.equal(await sharedRuntimeRunning(state), false)
  assert.equal(await exists(join(state, 'harness/nook.lock')), false)
  console.log('Second start: persistent authentication, verified pre-start backup, and clean exit passed.')
  succeeded = true
} finally {
  await Promise.all([...children].map(close))
  await peer?.stop()
  if (succeeded) await rm(state, { recursive: true, force: true })
  else console.error(`Failed acceptance state retained: ${state}`)
}
