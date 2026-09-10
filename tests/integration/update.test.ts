import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { test } from 'node:test'
import { mkdtemp, cp, mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { connect } from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { SharedRuntime, type BrokerLaunch } from '../../apps/desktop/src/shared-client.ts'
import { runtimeSocket } from '../../apps/desktop/src/shared-paths.ts'
import { readActiveUpdate } from '../../apps/desktop/src/update.ts'
const exec = promisify(execFile)
const require = createRequire(import.meta.url)

for (const fail of [false, true])
  test(
    `broker update ${fail ? 'recovers after candidate migration and startup failure' : 'switches both leases and persists the selected runtime'}`,
    { timeout: 30000 },
    async t => {
      const root = await mkdtemp(join(tmpdir(), 'nook-update-integration-'))
      if (process.env.NOOK_KEEP_UPDATE_TEST) console.log(root)
      const clients: SharedRuntime[] = []
      t.after(async () => {
        await Promise.all(clients.map(c => c.stop()))
        if (!process.env.NOOK_KEEP_UPDATE_TEST) await rm(root, { recursive: true, force: true })
      })
      const repo = join(root, 'repo'),
        profile = join(root, 'harness/profiles/nook'),
        candidate = join(root, 'runtimes/candidate/profile')
      const base = createRequire(require.resolve('@deepseek-ai/dsh/package.json')).resolve(
        '@deepseek-ai/dsh-base/package.json',
      )
      for (const p of [profile, candidate]) {
        await mkdir(join(p, 'node_modules/@deepseek-ai/dsh'), { recursive: true })
        await mkdir(join(p, 'node_modules/@nook-dsh'), { recursive: true })
        if (p === candidate) {
          await cp(dirname(base), join(p, 'node_modules/@deepseek-ai/dsh-base'), { recursive: true })
          const persistence = dirname(
            createRequire(base).resolve('@deepseek-ai/dsh-session-persistence-jsonl/package.json'),
          )
          await mkdir(join(dirname(p), 'node_modules/@deepseek-ai'), { recursive: true })
          await symlink(persistence, join(dirname(p), 'node_modules/@deepseek-ai/dsh-session-persistence-jsonl'))
          await cp(resolve('packages/storage-backup'), join(p, 'node_modules/@nook-dsh/storage-backup'), {
            recursive: true,
          })
        } else {
          await symlink(dirname(base), join(p, 'node_modules/@deepseek-ai/dsh-base'))
          await symlink(resolve('packages/storage-backup'), join(p, 'node_modules/@nook-dsh/storage-backup'))
        }
        await writeFile(join(p, 'package.json'), JSON.stringify({ dsh: { profile: { bundles: [] } } }))
        await writeFile(
          join(p, 'node_modules/@deepseek-ai/dsh/package.json'),
          JSON.stringify({ type: 'module', bin: { dsh: 'cli.mjs' } }),
        )
        await writeFile(
          join(p, 'node_modules/@deepseek-ai/dsh/cli.mjs'),
          `
import { createServer } from 'node:http';
import { writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
writeFileSync(${JSON.stringify(join(root, 'control.json'))}, JSON.stringify({token:process.env.NOOK_UPDATE_TOKEN}));
appendFileSync(${JSON.stringify(join(root, 'starts'))}, ${JSON.stringify(p === candidate ? 'new\n' : 'old\n')});
${p === candidate ? `writeFileSync(join(process.env.DSH_HOME, 'credential'), 'migrated'); ${fail ? 'process.exit(3);' : ''}` : ''}
const port = Number(process.argv[process.argv.indexOf('--port')+1]);
const server = createServer((req,res) => { if (req.url.includes('token=')) { res.writeHead(302, {'location':'/', 'set-cookie':'auth=test; Path=/'}); res.end(); } else res.end('<html>test runtime</html>'); });
server.listen(port, '127.0.0.1', () => console.log('dsh web: http://127.0.0.1:'+server.address().port+'/?token=synthetic-update'));
process.on('SIGTERM', () => server.close());
`,
        )
      }
      await writeFile(join(root, 'harness/credential'), 'original')
      await mkdir(join(repo, 'scripts/update'), { recursive: true })
      const snapshot = {
        seedProfile: candidate,
        node: process.execPath,
        supervisor: resolve('apps/desktop/dist/supervisor.mjs'),
      }
      await writeFile(
        join(repo, 'scripts/update/prepare-update.mjs'),
        `import {mkdir,writeFile} from 'node:fs/promises';import{join}from'node:path';const a=JSON.parse(process.argv[2]);await mkdir(a.directory,{recursive:true});await writeFile(join(a.directory,'candidate.json'),JSON.stringify({protocol:1,commit:a.commit,snapshot:${JSON.stringify(snapshot)},broker:${JSON.stringify(resolve('apps/desktop/dist/shared-broker.mjs'))}}));`,
      )
      const git = async (...args: string[]) => (await exec('git', ['-C', repo, ...args])).stdout.trim()
      await git('init', '-b', 'main')
      await git('config', 'user.name', 'Nook Test')
      await git('config', 'user.email', 'test@example.invalid')
      await git('add', '.')
      await git('commit', '-m', 'initial')
      const current = await git('rev-parse', 'HEAD')
      await writeFile(join(repo, 'new-version'), 'next')
      await git('add', '.')
      await git('commit', '-m', 'candidate')
      const target = await git('rev-parse', 'HEAD')
      await git('remote', 'add', 'origin', repo)
      const launch: BrokerLaunch = {
        node: process.execPath,
        broker: resolve('apps/desktop/dist/shared-broker.mjs'),
        options: {
          state: root,
          update: { repo, current, remote: 'origin', branch: 'main' },
          config: {
            home: join(root, 'harness'),
            profile: 'nook',
            node: process.execPath,
            bin: join(profile, 'node_modules/@deepseek-ai/dsh/cli.mjs'),
            supervisor: resolve('apps/desktop/dist/supervisor.mjs'),
            cwd: root,
          },
        },
      }
      for (let i = 0; i < 2; i++)
        clients.push(
          new SharedRuntime(
            root,
            async () => launch,
            () => {},
            () => {},
          ),
        )
      const urls = await Promise.all(clients.map(c => c.ready))
      assert.equal(urls[0], urls[1])
      const token = JSON.parse(await readFile(join(root, 'control.json'), 'utf8')).token
      const command = (command: string, auth = token): Promise<any> =>
        new Promise((resolveResponse, reject) => {
          const socket = connect(runtimeSocket(root))
          let text = ''
          const timer = setTimeout(() => {
            socket.destroy()
            reject(new Error('control timeout'))
          }, 3000)
          socket.on('error', reject)
          socket.once('connect', () => socket.write(JSON.stringify({ type: 'update', token: auth, command }) + '\n'))
          socket.on('data', chunk => {
            text += chunk.toString()
          })
          socket.once('close', () => {
            clearTimeout(timer)
            resolveResponse(text ? JSON.parse(text).status : null)
          })
        })
      const until = async (phase: string) => {
        const deadline = Date.now() + 15000
        for (;;) {
          const status = await command('status')
          if (status.phase === phase) return status
          if (Date.now() > deadline || status.phase === 'failed') throw new Error(JSON.stringify(status))
          await delay(30)
        }
      }
      assert.equal(await command('start', 'wrong-token'), null)
      await command('check')
      await until('available')
      await command('start')
      const status = await until(fail ? 'failed' : 'succeeded')
      assert.equal(status.current, fail ? current : target)
      assert.equal(await readFile(join(root, 'harness/credential'), 'utf8'), fail ? 'original' : 'migrated')
      assert.equal((await fetch(new URL('/', urls[0]!))).status, 200)
      if (!fail) {
        const active = await readActiveUpdate(root)
        assert.equal(active?.launch.options.update?.current, target)
        await clients[0]!.stop()
        await clients[1]!.stop()
        const restarted = new SharedRuntime(
          root,
          async () => active!.launch,
          () => {},
          () => {},
        )
        clients.push(restarted)
        assert.equal(new URL(await restarted.ready).port, new URL(urls[0]!).port)
      }
    },
  )
