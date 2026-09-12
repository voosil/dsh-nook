import assert from 'node:assert/strict'

import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'

import { tmpdir } from 'node:os'

import { join } from 'node:path'

import { test } from 'node:test'

import { corepackCommand } from '../../../scripts/shared/corepack-command.mjs'

import { ProcessScope } from '../../../scripts/shared/process-scope.mjs'

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
