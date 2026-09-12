import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
export async function backupDirectories(state) {
  const entries = await readdir(join(state, 'backups'), { withFileTypes: true }).catch(error => {
    if (error.code !== 'ENOENT') throw error
    return []
  })
  return entries.filter(entry => entry.isDirectory() && !entry.name.startsWith('.')).map(entry => entry.name)
}
