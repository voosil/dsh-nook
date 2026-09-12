import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { inflateSync } from 'node:zlib'
import { installerArtifacts } from '../../../../scripts/sync-server/artifacts.mjs'

test('embedded one-line installer contains the exact downloadable source without shell interpolation', async () => {
  const { source, command } = await installerArtifacts()
  assert.ok(!command.includes('\n'))
  const payload = command.match(/b64decode\("([A-Za-z0-9+/=]+)"\)/)?.[1]
  assert.ok(payload)
  assert.equal(inflateSync(Buffer.from(payload, 'base64')).toString(), source)
  const python = command.slice("sudo python3 -c '".length, -1)
  const help = execFileSync(process.env.NOOK_TEST_PYTHON ?? 'python3', ['-c', python, '--help'], { encoding: 'utf8' })
  assert.match(help, /vpn,ip,domain/)
})
