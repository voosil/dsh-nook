import { ProcessScope } from '../shared/process-scope.mjs'
import { ROOT, PNPM_VERSION } from '../profile/profile-lib.mjs'
import { runGroups } from '../test/run.mjs'

const scope = new ProcessScope()
let interrupted = false
let cleanup
const dispose = () => (cleanup ??= scope.dispose())
const stop = () => {
  interrupted = true
  void dispose().catch(error => console.error(error.message))
}
process.once('SIGINT', stop)
process.once('SIGTERM', stop)
try {
  for (const command of [
    'format:check',
    'docs:check',
    'verify:boundaries',
    'lint:css',
    'verify:ui-tokens',
    'verify:peers',
    'build',
    'dev:profile',
  ]) {
    if (interrupted) throw new Error('Verification interrupted')
    await scope.run('corepack', [`pnpm@${PNPM_VERSION}`, 'run', command], { cwd: ROOT, windowsHide: true })
  }
  if (interrupted) throw new Error('Verification interrupted')
  await runGroups(['unit', 'component', 'integration', 'e2e'], { prepared: true })
} finally {
  try {
    await dispose()
  } finally {
    process.off('SIGINT', stop)
    process.off('SIGTERM', stop)
  }
}
