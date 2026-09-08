import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { SharedRuntime, type BrokerLaunch } from '../../apps/desktop/src/shared-client.ts'

async function fixture(root: string): Promise<BrokerLaunch> {
  const home = join(root, 'harness')
  const profile = join(home, 'profiles/nook')
  await mkdir(join(profile, 'node_modules/@nook-dsh'), { recursive: true })
  await mkdir(join(profile, 'node_modules/@deepseek-ai'), { recursive: true })
  await writeFile(join(profile, 'package.json'), '{}')
  await symlink(resolve('packages/storage-backup'), join(profile, 'node_modules/@nook-dsh/storage-backup'))
  const require = createRequire(import.meta.url)
  const dsh = createRequire(require.resolve('@deepseek-ai/dsh/package.json'))
  await symlink(
    dirname(dsh.resolve('@deepseek-ai/dsh-base/package.json')),
    join(profile, 'node_modules/@deepseek-ai/dsh-base'),
  )
  const bin = join(root, 'fake-dsh.mjs')
  await writeFile(
    bin,
    `import {createServer} from 'node:http';
import {appendFileSync} from 'node:fs';
appendFileSync(${JSON.stringify(join(root, 'starts'))}, 'start\\n');
const server=createServer((_req,res)=>res.end('shared'));
server.listen(0,'127.0.0.1',()=>console.log('dsh web: http://127.0.0.1:'+server.address().port+'/?token=synthetic-shared'));
`,
  )
  return {
    node: process.execPath,
    broker: resolve('apps/desktop/dist/shared-broker.mjs'),
    options: {
      state: root,
      config: {
        home,
        profile: 'nook',
        bin,
        node: process.execPath,
        supervisor: resolve('apps/desktop/dist/supervisor.mjs'),
        cwd: root,
      },
    },
  }
}

test(
  'simultaneous Web and desktop leases share one backend; closing either preserves the other',
  { timeout: 30_000 },
  async t => {
    const root = await mkdtemp(join(tmpdir(), 'nook-shared-test-'))
    const clients: SharedRuntime[] = []
    t.after(async () => {
      await Promise.all(clients.map(client => client.stop()))
      await rm(root, { recursive: true, force: true })
    })

    const launch = await fixture(root)
    const logs: string[] = []
    for (let i = 0; i < 2; i++)
      clients.push(
        new SharedRuntime(
          root,
          async () => launch,
          line => logs.push(line),
          () => {},
        ),
      )
    const urls = await Promise.all(clients.map(client => client.ready))
    assert.equal(urls[0], urls[1])
    assert.equal(await readFile(join(root, 'starts'), 'utf8'), 'start\n')
    await clients[0]!.stop()
    assert.equal(await (await fetch(urls[1]!)).text(), 'shared')
    const late = new SharedRuntime(
      root,
      async () => {
        throw new Error('Must reuse the running backend without preparing another runtime')
      },
      () => {},
      () => {},
    )
    clients.push(late)
    assert.equal(await late.ready, urls[0])
    await clients[1]!.stop()
    assert.equal(await (await fetch(urls[1]!)).text(), 'shared')
    await late.stop()
    await assert.rejects(fetch(urls[0]!, { signal: AbortSignal.timeout(1000) }))
    assert.equal(logs.join('').includes('synthetic-shared'), false)
    const reopened = new SharedRuntime(
      root,
      async () => launch,
      () => {},
      () => {},
    )
    clients.push(reopened)
    await reopened.ready
    assert.equal(await readFile(join(root, 'starts'), 'utf8'), 'start\nstart\n')
  },
)

test('closing a frontend before broker startup settles readiness and shutdown', { timeout: 10_000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'nook-shared-cancel-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const launch = await fixture(root)
  const client = new SharedRuntime(
    root,
    async () => {
      await delay(50)
      return launch
    },
    () => {},
    () => {},
  )
  await client.stop()
  await assert.rejects(client.ready, /cancelled/)
  await assert.rejects(readFile(join(root, 'starts')), { code: 'ENOENT' })
})

test(
  'the frontend that starts the broker can crash while another frontend keeps working',
  { timeout: 30_000 },
  async t => {
    const root = await mkdtemp(join(tmpdir(), 'nook-shared-crash-'))
    const launch = await fixture(root)
    const entry = join(root, 'frontend.mts')
    await writeFile(
      entry,
      `import {SharedRuntime} from ${JSON.stringify(resolve('apps/desktop/src/shared-client.ts'))};
const runtime=new SharedRuntime(${JSON.stringify(root)},async()=>(${JSON.stringify(launch)}),()=>{},()=>{});
process.send?.({url:await runtime.ready});`,
    )
    const parent = fork(entry, {
      execArgv: ['--import', resolve('node_modules/tsx/dist/loader.mjs')],
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
    })
    let peer: SharedRuntime | undefined
    t.after(async () => {
      parent.kill('SIGKILL')
      await peer?.stop()
      await rm(root, { recursive: true, force: true })
    })
    const [message] = await once(parent, 'message')
    peer = new SharedRuntime(
      root,
      async () => {
        throw new Error('Must reuse crashed frontend broker')
      },
      () => {},
      () => {},
    )
    const url = await peer.ready
    assert.equal(url, message.url)
    const exited = once(parent, 'exit')
    parent.kill('SIGKILL')
    await exited
    assert.equal(await (await fetch(url)).text(), 'shared')
    await peer.stop()
    await assert.rejects(fetch(url, { signal: AbortSignal.timeout(1000) }))
  },
)
