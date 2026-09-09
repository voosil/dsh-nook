import { randomUUID } from 'node:crypto'
import { mkdir, open } from 'node:fs/promises'
import { join } from 'node:path'

/** Only receipts minted by this window may be revealed; the renderer never supplies paths. */
export class NoteExports {
  private readonly paths = new Map<string, string>()
  constructor(private readonly directory: string) {}

  async save(request: unknown): Promise<{ id: string; name: string }> {
    if (!request || typeof request !== 'object') throw new Error('导出内容无效。')
    const { name, markdown } = request as Record<string, unknown>
    if (
      typeof name !== 'string' ||
      !name ||
      name.length > 200 ||
      typeof markdown !== 'string' ||
      markdown.length > 501_000
    )
      throw new Error('导出内容无效。')
    const stem =
      name
        .replace(/\.md$/i, '')
        .replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, '_')
        .replace(/^\.+/, '_')
        .slice(0, 60) || '笔记'
    await mkdir(this.directory, { recursive: true })
    for (let index = 0; index < 10_000; index++) {
      const filename = `${stem}${index ? ` (${index})` : ''}.md`
      const path = join(this.directory, filename)
      let file
      try {
        file = await open(path, 'wx', 0o600)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'EEXIST') continue
        throw error
      }
      try {
        await file.writeFile(markdown, 'utf8')
        await file.sync()
      } finally {
        await file.close()
      }
      const id = randomUUID()
      this.paths.set(id, path)
      if (this.paths.size > 100) this.paths.delete(this.paths.keys().next().value!)
      return { id, name: filename }
    }
    throw new Error('同名导出文件过多，请整理下载文件夹。')
  }

  path(id: unknown): string {
    const path = typeof id === 'string' ? this.paths.get(id) : undefined
    if (!path) throw new Error('导出记录已过期，请重新导出。')
    return path
  }

  dispose() {
    this.paths.clear()
  }
}
