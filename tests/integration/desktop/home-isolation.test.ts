import assert from 'node:assert/strict'

import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises'

import { tmpdir } from 'node:os'

import { join } from 'node:path'

import { test } from 'node:test'

import { safeHome } from '../../../apps/desktop/src/policy.ts'

test('real DSH home aliases are refused', async () => {
  const root = await mkdtemp(join(tmpdir(), 'nook-home-test-'))
  try {
    const user = join(root, 'user')
    await mkdir(join(user, '.dsh'), { recursive: true })
    await symlink(join(user, '.dsh'), join(root, 'alias'))
    assert.throws(() => safeHome(join(root, 'alias', 'nested'), user), /real DSH/)
    assert.equal(safeHome(join(root, 'fresh'), user), join(await realpath(root), 'fresh'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
