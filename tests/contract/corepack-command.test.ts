import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { corepackCommand } from '../../scripts/shared/corepack-command.mjs'
import { ProcessScope } from '../../scripts/shared/process-scope.mjs'

test(
  'Windows build cancellation reaps the owned subprocess tree',
  { skip: process.platform !== 'win32', timeout: 10_000 },
  async () => {
    const scope = new ProcessScope()
    try {
      const child = scope.spawn(
        process.execPath,
        [
          '-e',
          `
      const {spawn}=require('node:child_process');
      const worker=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
      console.log(worker.pid); setInterval(()=>{},1000);
    `,
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      )
      const [chunk] = await once(child.stdout, 'data')
      const pid = Number(chunk.toString().trim())
      assert.ok(pid > 1)
      await scope.stop(child)
      for (let attempt = 0; attempt < 50; attempt++) {
        try {
          process.kill(pid, 0)
        } catch (error) {
          assert.equal(error.code, 'ESRCH')
          return
        }
        await delay(20)
      }
      assert.fail('Build descendant survived cancellation')
    } finally {
      await scope.dispose()
    }
  },
)

test('Unix retains the Corepack executable and pinned arguments', () => {
  const args = ['pnpm@12.1.0', 'run', 'build']
  assert.deepEqual(corepackCommand(args, { platform: 'linux' }), ['corepack', args])
})

test('Windows launches the declared CLI with literal arguments and paths containing spaces', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nook corepack '))
  const scope = new ProcessScope()
  try {
    const directory = join(root, 'node_modules/corepack')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'package.json'), JSON.stringify({ bin: { corepack: './cli.cjs' } }))
    await writeFile(join(directory, 'cli.cjs'), 'console.log(JSON.stringify(process.argv.slice(2)))')
    const args = ['pnpm@12.1.0', 'path with spaces', '& echo unexpected', '%PATH%']
    const [command, commandArgs] = corepackCommand(args, { platform: 'win32', env: { Path: root } })
    const result = await scope.run(command, commandArgs, { capture: true })
    assert.deepEqual(JSON.parse(result.stdout), args)
    assert.throws(
      () => corepackCommand(args, { platform: 'win32', env: {}, node: join(root, 'missing/node.exe') }),
      /Cannot locate the Corepack CLI/,
    )
  } finally {
    await scope.dispose()
    await rm(root, { recursive: true, force: true })
  }
})
