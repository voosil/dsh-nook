import { assertKnownPeerWarnings } from '../shared/peer-policy.mjs'
import { runPnpm } from '../profile/profile-lib.mjs'

const result = await runPnpm(['peers', 'check'], {
  capture: true,
  allowedExitCodes: [1],
})
if (result.code === 1) assertKnownPeerWarnings(`${result.stdout}${result.stderr}`)
process.stdout.write('Verified peer policy: no unreviewed dependency mismatches.\n')
