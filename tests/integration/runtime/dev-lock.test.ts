import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { acquireNativeFileLock } from '../../../scripts/shared/native-file-lock.mjs'

test('native development lock stays exclusive through aliases and repeated disposal', async t => {
  const root = await mkdtemp(join(tmpdir(), 'nook-dev-lock-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'home'))
  await symlink(join(root, 'home'), join(root, 'alias'), 'junction')
  const file = join(root, 'home/lease')
  const release = acquireNativeFileLock(file)
  t.after(release)
  const busy = (error: NodeJS.ErrnoException) => ['EAGAIN', 'EWOULDBLOCK'].includes(error.code ?? '')
  assert.throws(() => acquireNativeFileLock(join(root, 'alias/lease')), busy)
  release()
  const next = acquireNativeFileLock(file)
  t.after(next)
  release()
  assert.throws(() => acquireNativeFileLock(file), busy)
  next()
  assert.throws(() => acquireNativeFileLock(join(root, 'missing/lease')), { code: 'ENOENT' })
})

test('simultaneous processes have one lock owner and recover after forced exit', { timeout: 20_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'nook-dev-lock-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const worker = join(root, 'owner.mjs')
  const module = new URL('../../../scripts/shared/native-file-lock.mjs', import.meta.url).href
  await writeFile(
    worker,
    `import { acquireNativeFileLock } from ${JSON.stringify(module)}
     process.once('message', file => {
       try {
         acquireNativeFileLock(file)
         process.on('message', () => {})
         process.send('locked')
       } catch (error) {
         process.send(error.code)
         process.disconnect()
       }
     })`,
  )
  const file = join(root, 'lease')
  for (let round = 0; round < 3; round++) {
    const contenders = Array.from({ length: 3 }, () => {
      const child = fork(worker, { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
      const exited = once(child, 'exit')
      t.after(async () => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
        await exited
      })
      const message = once(child, 'message')
      return { child, exited, message }
    })
    for (const { child } of contenders) child.send(file)
    const results = await Promise.all(contenders.map(({ message }) => message.then(([value]) => value)))
    assert.equal(results.filter(value => value === 'locked').length, 1)
    assert.equal(results.filter(value => ['EAGAIN', 'EWOULDBLOCK'].includes(value)).length, 2)
    const owner = contenders[results.indexOf('locked')]
    owner.child.kill('SIGKILL')
    await Promise.all(contenders.map(({ exited }) => exited))
    acquireNativeFileLock(file)()
  }
})
