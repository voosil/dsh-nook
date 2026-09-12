import { test } from 'node:test'
import { runNotebookAcceptance } from '../../../helpers/scenarios/notebook.mjs'
import { backupDirectories } from '../../../helpers/runtime/backups.mjs'
import assert from 'node:assert/strict'
import { fork, spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { ROOT, runPnpm } from '../../../../scripts/profile/profile-lib.mjs'
import { SharedRuntime } from '../../../../apps/desktop/dist/shared-client.mjs'
import { verifySavedNotebook } from '../../../helpers/browser/notebook.mjs'
import { verifyBackupRecovery } from '../../../helpers/scenarios/notebook-outcomes.mjs'
test('Windows startup preserves content, credentials, backups and process cleanup', { timeout: 1500000 }, async t => {
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
      env: {
        ...process.env,
        DSH_HOME: join(state, 'harness'),
        DSH_TELEMETRY_MODE: 'DISABLED',
        // The shared browser smoke exercises an offline installation, without this checkout's real update remote.
        NOOK_UPDATE_REMOTE: 'nook-start-acceptance-no-remote',
      },
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

  async function verifyPortReleased(port) {
    const deadline = Date.now() + 10_000
    while (true) {
      const server = createServer()
      try {
        const listening = once(server, 'listening')
        server.listen({ host: '127.0.0.1', port, exclusive: true })
        await listening
        return
      } catch (error) {
        if (!['EADDRINUSE', 'EACCES'].includes(error.code) || Date.now() >= deadline) throw error
      } finally {
        if (server.listening)
          await new Promise((resolve, reject) => server.close(error => (error ? reject(error) : resolve())))
      }
      await delay(100)
    }
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
    const legacy = spawnSync(process.execPath, ['-e', 'console.log(process.pid)'], { encoding: 'utf8' })
    assert.equal(legacy.status, 0)
    await mkdir(join(state, 'harness/nook.lock'), { recursive: true })
    await writeFile(join(state, 'harness/nook.lock/owner.json'), JSON.stringify({ pid: Number(legacy.stdout.trim()) }))
    const first = await launch('0')
    console.log('First start: authenticated URL received from a clean packed Profile.')
    const origin = new URL(first.url).origin
    assert.equal((await fetch(origin)).status, 401)
    const exchange = await fetch(first.url, { redirect: 'manual' })
    assert.equal(exchange.status, 303)
    const cookie = exchange.headers.get('set-cookie').split(';', 1)[0]
    await mkdir(join(ROOT, '.pack'), { recursive: true })
    const expected = await runNotebookAcceptance(t, {
      url: first.url,
      screenshot: join(ROOT, '.pack/windows-start.png'),
      profileDirectory: join(state, 'harness/profiles/nook'),
    })
    await verifySavedNotebook(first.url, expected)
    console.log('Browser acceptance: project/note create, save, reload, recycle, restore and sync passed.')
    peer = new SharedRuntime(
      state,
      async () => {
        throw new Error('Existing backend must be reused')
      },
      () => {},
      () => {},
    )
    const peerUrl = await peer.ready
    await verifySavedNotebook(peerUrl, expected)
    // A stale saved update must not override the current source launch.
    await mkdir(join(state, 'updates'), { recursive: true })
    await writeFile(join(state, 'updates/active.json'), JSON.stringify({ protocol: -1, stale: true }))
    const oldExited = once(first.child, 'exit')
    const before = await backupDirectories(state)
    const monitoring = new AbortController()
    let servedDuringRestart = 0
    const observed = (async () => {
      while (!monitoring.signal.aborted && first.child.exitCode === null) {
        try {
          const response = await fetch(origin, {
            headers: { cookie },
            signal: AbortSignal.any([monitoring.signal, AbortSignal.timeout(2000)]),
          })
          if (response.status === 200) servedDuringRestart++
          await response.body?.cancel()
        } catch (error) {
          if (!monitoring.signal.aborted && error.name !== 'TimeoutError' && !(error instanceof TypeError)) throw error
        }
        await delay(100, undefined, { signal: monitoring.signal }).catch(() => {})
      }
    })()
    let second
    try {
      second = await launch(new URL(first.url).port)
    } finally {
      monitoring.abort()
      await observed
    }
    assert.ok(servedDuringRestart > 0, 'Existing clients must still receive responses while restart is preparing')
    await oldExited
    assert.equal(new URL(second.url).origin, origin, 'Restart must retain the requested address')
    await peer.stop()
    peer = undefined
    console.log('Source restart completed on the same port; releasing an old client did not stop the new backend.')
    await verifyBackupRecovery(state, before, expected, { profileDirectory: join(state, 'harness/profiles/nook') })
    assert.equal((await fetch(new URL(second.url).origin, { headers: { cookie } })).status, 200)
    const separator = cookie.indexOf('=')
    await verifySavedNotebook(origin, expected, [
      { name: cookie.slice(0, separator), value: cookie.slice(separator + 1), url: origin },
    ])
    await close(second.child)
    await verifyPortReleased(Number(new URL(second.url).port))
    const beforeManual = await backupDirectories(state)
    await runPnpm(
      ['run', 'backup', 'create', '--source', join(state, 'harness/nook'), '--output', join(state, 'backups')],
      {
        env: { DSH_HOME: join(state, 'harness') },
        capture: true,
      },
    )
    await verifyBackupRecovery(state, beforeManual, expected, {
      profileDirectory: join(state, 'harness/profiles/nook'),
    })
    console.log(
      'Restart preserved login and saved notes; backups restore content, the port is reusable, and offline backup succeeds after exit.',
    )
    succeeded = true
  } finally {
    await Promise.all([...children].map(close))
    await peer?.stop()
    if (succeeded) await rm(state, { recursive: true, force: true })
    else console.error(`Failed acceptance state retained: ${state}`)
  }
})
