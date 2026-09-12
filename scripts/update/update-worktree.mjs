import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { constants } from 'node:fs'
import { copyFile, lstat, mkdir, readdir, realpath } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

const exec = promisify(execFile)
const within = (root, path) => {
  const part = relative(root, path)
  return part === '' || (!isAbsolute(part) && part !== '..' && !part.startsWith(`..${sep}`))
}

/** The preparing broker's executable may belong to a disposable Web launcher. */
export async function retainCandidateNode(directory, executable = process.execPath) {
  const bin = join(directory, 'runtime/node/bin')
  await mkdir(bin, { recursive: true })
  const node = join(bin, process.platform === 'win32' ? 'node.exe' : 'node')
  await copyFile(executable, node, constants.COPYFILE_EXCL)
  return node
}

/** The installed snapshot must not retain workspace links into its disposable source. */
export async function assertIndependentCandidate(directory, candidate, commit) {
  if (candidate.protocol !== 1 || candidate.commit !== commit) throw new Error('Invalid update candidate')
  const root = await realpath(directory)
  const runtime = resolve(root, 'runtime'),
    boot = resolve(root, 'boot')
  for (const [path, owner, name] of [
    [candidate.snapshot?.seedProfile, runtime, 'runtime'],
    [candidate.snapshot?.node, runtime, 'runtime'],
    [candidate.snapshot?.supervisor, boot, 'boot'],
    [candidate.broker, boot, 'boot'],
  ]) {
    if (
      typeof path !== 'string' ||
      !isAbsolute(path) ||
      !within(resolve(directory, name), resolve(path)) ||
      !within(owner, await realpath(path))
    )
      throw new Error('Candidate path escapes its runtime')
  }
  async function visit(path, owner) {
    const stat = await lstat(path)
    if (stat.isSymbolicLink()) {
      if (!within(owner, await realpath(path))) throw new Error(`Candidate link escapes its runtime: ${path}`)
    } else if (stat.isDirectory()) {
      for (const name of await readdir(path)) await visit(join(path, name), owner)
    } else if (!stat.isFile()) throw new Error(`Unsupported candidate file: ${path}`)
  }
  await visit(runtime, runtime)
  await visit(boot, boot)
}

/** Only the fresh build checkout created by this preparation may be force-removed. */
export async function removeUpdateWorktree(repo, checkout, commit) {
  const { stdout } = await exec('git', ['-C', checkout, 'rev-parse', 'HEAD'], { timeout: 30000 })
  if (stdout.trim() !== commit) throw new Error('Update worktree HEAD changed; source retained')
  // Ignore generated build output but never discard tracked edits or unfamiliar untracked files.
  const status = await exec('git', ['-C', checkout, 'status', '--porcelain', '--untracked-files=all'], {
    timeout: 30000,
  })
  if (status.stdout.trim()) throw new Error('Update worktree has unexpected changes; source retained')
  // Installed dependency trees can take longer to remove than to inspect. Keep
  // the operation bounded and enable Windows long paths for this command only.
  const config = process.platform === 'win32' ? ['-c', 'core.longpaths=true'] : []
  await exec('git', [...config, '-C', repo, 'worktree', 'remove', '--force', checkout], {
    timeout: 180_000,
    windowsHide: true,
  })
}
