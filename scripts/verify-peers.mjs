import { assertKnownPeerWarnings } from './peer-policy.mjs'
import { runPnpm } from './profile-lib.mjs'

const result = await runPnpm(['peers', 'check'], {
  capture: true,
  allowedExitCodes: [1],
})
if (result.code !== 1) throw new Error('expected the documented community browser peer-range mismatch')
assertKnownPeerWarnings(`${result.stdout}${result.stderr}`)
process.stdout.write('Verified peer policy: only the two documented dsh-browser-playwright@0.1.1 warnings remain.\n')
