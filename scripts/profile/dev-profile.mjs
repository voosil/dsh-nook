import { DEV_AGENTS_HOME, DEV_HOME, PROFILE_DIR, installProfile, writeDevProfile } from './profile-lib.mjs'

await writeDevProfile()
await installProfile()

process.stdout.write(
  `Nook profile ready.\nDSH_HOME=${DEV_HOME}\nDSH_AGENTS_HOME=${DEV_AGENTS_HOME}\nProfile=${PROFILE_DIR}\n`,
)
