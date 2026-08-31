import { resolve } from 'node:path'
import {
  devRuntimeEnv,
  dshBin,
  exists,
  installProfile,
  PROFILE_DIR,
  ROOT,
  run,
  writeDevProfile,
} from './profile-lib.mjs'
import { releasePort } from './release-port.mjs'
import { createProfileArgs, resolveDevPort } from './run-profile-args.mjs'

if (!(await exists(resolve(PROFILE_DIR, 'package.json')))) {
  await writeDevProfile()
}
if (!(await exists(resolve(PROFILE_DIR, 'node_modules')))) {
  await installProfile()
}
const inputArgs = process.argv.slice(2)
const port = resolveDevPort(inputArgs)
if (port !== undefined && port !== 0) {
  const released = await releasePort(port)
  if (released.length > 0) process.stdout.write(`Released port ${port} from PID ${released.join(', ')}.\n`)
}
const dshArgs = createProfileArgs(dshBin(), ROOT, inputArgs)
await run(process.execPath, dshArgs, {
  env: devRuntimeEnv(),
})
