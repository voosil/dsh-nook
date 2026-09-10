import { createReadStream } from 'node:fs'
import { createHash, randomUUID } from 'node:crypto'
import { cp, lstat, mkdir, readFile, readdir, rename } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import type * as Backup from '../../../packages/storage-backup/src/index.js'
type BackupApi = Pick<typeof Backup, 'createBackup' | 'verifyBackup' | 'restoreBackup'>
import { saveJson, readActiveUpdate, type ActiveUpdate } from './update.js'

const generatedModules = (path: string) =>
  path === 'node_modules' ||
  path === 'profiles/node_modules' ||
  /^profiles\/[^/]+\/(node_modules|\.dsh-module-fallback)$/.test(path)
async function files(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {}
  async function visit(path: string) {
    const name = relative(root, path).split(sep).join('/')
    if (generatedModules(name)) return
    const info = await lstat(path)
    if (info.isSymbolicLink()) throw new Error(`完整更新备份不支持符号链接：${name}`)
    if (info.isDirectory()) {
      result[name] = 'directory'
      for (const child of (await readdir(path)).sort()) await visit(join(path, child))
    } else if (info.isFile()) {
      const hash = createHash('sha256')
      for await (const chunk of createReadStream(path)) hash.update(chunk)
      result[name] = hash.digest('hex')
    } else throw new Error(`完整更新备份不支持特殊文件：${name}`)
  }
  await visit(root)
  return result
}
interface Recovery {
  protocol: 1
  previous: string
  backup: string
  failed: string
  stage: 'prepared' | 'retained' | 'candidate' | 'restoring' | 'committed'
  active?: ActiveUpdate
}
const journal = (state: string) => join(state, 'updates/recovery.json')
export async function retainHome(
  state: string,
  { createBackup, verifyBackup, restoreBackup }: BackupApi,
): Promise<Recovery> {
  const home = join(state, 'harness'),
    id = randomUUID()
  const directory = join(state, 'updates', id)
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const copy = join(directory, 'snapshot')
  const before = await files(home)
  await cp(home, copy, {
    recursive: true,
    filter: source => !generatedModules(relative(home, source).split(sep).join('/')),
  })
  if (
    JSON.stringify(before) !== JSON.stringify(await files(copy)) ||
    JSON.stringify(before) !== JSON.stringify(await files(home))
  )
    throw new Error('更新备份校验失败，数据目录保持原位。')
  const backup = createBackup(copy, join(state, 'backups'), 'before-application-update-full-home')
  verifyBackup(backup)
  const receipt: Recovery = {
    protocol: 1,
    previous: join(directory, 'previous-home'),
    backup,
    failed: join(directory, 'failed-home'),
    stage: 'prepared',
  }
  const active = await readActiveUpdate(state)
  if (active) await saveJson(join(state, 'updates/active.json'), active)
  await saveJson(journal(state), receipt)
  await rename(home, receipt.previous)
  receipt.stage = 'retained'
  await saveJson(journal(state), receipt)
  restoreBackup(backup, home)
  receipt.stage = 'candidate'
  await saveJson(journal(state), receipt)
  return receipt
}
export async function commitHome(state: string, active: ActiveUpdate): Promise<void> {
  const receipt = JSON.parse(await readFile(journal(state), 'utf8')) as Recovery
  receipt.stage = 'committed'
  receipt.active = active
  await saveJson(journal(state), receipt)
}
/** Recovery preserves both home directories; it never overwrites post-update data. */
export async function recoverHome(state: string, { verifyBackup }: BackupApi): Promise<boolean> {
  let receipt: Recovery
  try {
    receipt = JSON.parse(await readFile(journal(state), 'utf8')) as Recovery
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
  if (receipt.protocol !== 1) throw new Error('Unsupported update recovery journal')
  if (receipt.stage === 'committed') return false
  verifyBackup(receipt.backup)
  const home = join(state, 'harness')
  try {
    await lstat(receipt.previous)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    if (receipt.stage === 'prepared') return false
    if (receipt.stage === 'restoring') {
      // The original directory rename completed before the process was interrupted.
      if (!(await lstat(home)).isDirectory()) throw new Error('更新恢复目录无效。')
      receipt.stage = 'committed'
      await saveJson(journal(state), receipt)
      return true
    }
    throw error
  }
  receipt.stage = 'restoring'
  await saveJson(journal(state), receipt)
  try {
    await lstat(home)
    await rename(home, receipt.failed)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  await rename(receipt.previous, home)
  receipt.stage = 'committed'
  await saveJson(journal(state), receipt)
  return true
}
