import assert from 'node:assert/strict'

import { test } from 'node:test'

import { corepackCommand } from '../../../scripts/shared/corepack-command.mjs'

test('Unix retains the Corepack executable and pinned arguments', () => {
  const args = ['pnpm@12.1.0', 'run', 'build']
  assert.deepEqual(corepackCommand(args, { platform: 'linux' }), ['corepack', args])
})
