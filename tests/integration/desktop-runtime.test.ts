import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'
import { DesktopRuntime } from '../../apps/desktop/src/runtime.ts'
import type { RuntimeConfig } from '../../apps/desktop/src/payload.ts'

async function fixture(root: string): Promise<RuntimeConfig> {
  const home = join(root, 'home')
  const profile = join(home, 'profiles/nook')
  await mkdir(join(profile, 'node_modules/@nook-dsh'), { recursive: true })
  await writeFile(join(profile, 'package.json'), '{}')
  await symlink(resolve('packages/storage-backup'), join(profile, 'node_modules/@nook-dsh/storage-backup'))
  const bin = join(root, 'fake-dsh.mjs')
  await writeFile(
    bin,
    `import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const descendant=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
descendant.unref();
writeFileSync(${JSON.stringify(join(root, 'pids.json'))},JSON.stringify([process.pid,descendant.pid]));
const server=createServer((_req,res)=>res.end('ok'));
process.once('SIGTERM',()=>{writeFileSync(${JSON.stringify(join(root, 'graceful'))},'yes');server.close()});
server.listen(0,'127.0.0.1',()=>console.log('dsh web: http://127.0.0.1:'+server.address().port+'/?token=synthetic-secret'));
`,
  )
  return {
    home,
    profile: 'nook',
    node: process.execPath,
    bin,
    cwd: root,
    supervisor: resolve('apps/desktop/dist/supervisor.mjs'),
  }
}

async function assertGone(pids: number[]) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (
      pids.every(pid => {
        try {
          process.kill(pid, 0)
          return false
        } catch {
          return true
        }
      })
    )
      return
    await delay(100)
  }
  assert.fail(`Runtime processes survived shutdown: ${pids.join(', ')}`)
}

test(
  'Windows kernel job reaps descendants if the supervisor crashes',
  { skip: process.platform !== 'win32', timeout: 20_000 },
  async () => {
    const root = await mkdtemp(join(tmpdir(), 'nook-job-crash-'))
    const config = await fixture(root)
    const child = fork(config.supervisor, [JSON.stringify(config)], {
      execArgv: [],
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    })
    try {
      await new Promise<void>((resolveReady, reject) => {
        const message = (value: { type?: string; message?: string }) => {
          if (value.type === 'ready' || value.type === 'failure') {
            child.off('message', message)
            if (value.type === 'ready') resolveReady()
            else reject(new Error(value.message))
          }
        }
        child.on('message', message)
      })
      const pids = JSON.parse(await readFile(join(root, 'pids.json'), 'utf8'))
      const exited = once(child, 'exit')
      child.kill('SIGKILL')
      await exited
      await assertGone(pids)
    } finally {
      child.kill('SIGKILL')
      await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
    }
  },
)

test('desktop shutdown is idempotent, redacts logs, and reaps DSH descendants', { timeout: 20_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'nook-supervisor-test-'))
  let runtime: DesktopRuntime | undefined
  try {
    const logs: string[] = []
    runtime = new DesktopRuntime(
      await fixture(root),
      line => logs.push(line),
      () => {},
    )
    const url = await runtime.ready
    assert.match(url, /token=synthetic-secret/)
    await delay(50)
    const pids = JSON.parse(await readFile(join(root, 'pids.json'), 'utf8'))
    const stopping = runtime.stop()
    assert.equal(runtime.stop(), stopping)
    await stopping
    assert.equal(await readFile(join(root, 'graceful'), 'utf8'), 'yes')
    await assertGone(pids)
    assert.equal(logs.join('\n').includes('synthetic-secret'), false)
    assert.match(logs.join('\n'), /REDACTED/)
  } finally {
    await runtime?.stop()
    await rm(root, { recursive: true, force: true })
  }
})

test('supervisor reaps runtime when its desktop parent crashes', { timeout: 20_000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'nook-supervisor-orphan-'))
  let parent: ReturnType<typeof fork> | undefined
  try {
    const config = await fixture(root)
    const entry = join(root, 'parent.mts')
    await writeFile(
      entry,
      `import { DesktopRuntime } from ${JSON.stringify(pathToFileURL(resolve('apps/desktop/src/runtime.ts')).href)};
const runtime=new DesktopRuntime(${JSON.stringify(config)},()=>{},()=>{});
await runtime.ready;process.send?.({ready:true});`,
    )
    parent = fork(entry, {
      execArgv: ['--import', pathToFileURL(resolve('node_modules/tsx/dist/loader.mjs')).href],
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    })
    await once(parent, 'message')
    const pids = JSON.parse(await readFile(join(root, 'pids.json'), 'utf8'))
    const exited = once(parent, 'exit')
    parent.kill('SIGKILL')
    await exited
    await assertGone(pids)
  } finally {
    parent?.kill('SIGKILL')
    await rm(root, { recursive: true, force: true })
  }
})
