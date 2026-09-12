import { once } from 'node:events'
import { join } from 'node:path'
import { ROOT, PROFILE_DIR } from '../../../scripts/profile/profile-lib.mjs'
import { ProcessScope } from '../../../scripts/shared/process-scope.mjs'
async function outcome(operation, args, { profileDirectory = PROFILE_DIR, node = process.execPath } = {}) {
  const scope = new ProcessScope()
  let cleanup
  const dispose = () => (cleanup ??= scope.dispose())
  try {
    const child = scope.spawn(node, [join(ROOT, 'tests/fixtures/notebook/outcomes.mjs'), profileDirectory, operation], {
      cwd: profileDirectory,
      env: { ...process.env, DSH_HOME: join(profileDirectory, '../..') },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let output = ''
    const capture = chunk => {
      output = (output + chunk.toString()).slice(-20000)
    }
    child.stdout.on('data', capture)
    child.stderr.on('data', capture)
    const completed = once(child, 'exit')
    const stdinError = () => {}
    child.stdin.on('error', stdinError)
    const timer = setTimeout(() => {
      void dispose().catch(error => console.error(error.message))
    }, 60_000)
    child.stdin.end(JSON.stringify(args))
    try {
      const [code, signal] = await completed
      if (code !== 0)
        throw new Error('Notebook ' + operation + ' verification failed (' + (code ?? signal) + '): ' + output)
    } finally {
      clearTimeout(timer)
      child.stdin.off('error', stdinError)
      child.stdout.off('data', capture)
      child.stderr.off('data', capture)
    }
  } finally {
    await dispose()
  }
}
export const verifyBackupRecovery = (state, before, expected, target) =>
  outcome('backup', [state, before, expected], target)
export const verifySyncTransfer = (connection, expected, target) => outcome('sync', [connection, expected], target)
