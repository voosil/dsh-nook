import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { writeRecoveryRecord } from '@nook-dsh/storage-backup'
import {
  ArtifactError,
  type ArtifactContentDto,
  type ArtifactDto,
  type ArtifactId,
  type ArtifactService,
  type WriteArtifactRequest,
} from '@nook-dsh/capability-artifact'
import type { ProjectId } from '@nook-dsh/capability-project'

declare module '@deepseek-ai/cordis' {
  interface Context {
    nookArtifacts: ArtifactService
  }
}

export interface Config {
  readonly root: string
  readonly maxBytes: number
}

export const Config: z<Config> = z.object({
  root: z.string().required(),
  maxBytes: z.number().min(1).max(100_000_000).step(1).default(20_000_000),
})

const SAFE_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function metadata(content: ArtifactContentDto): ArtifactDto {
  const { dataBase64: _data, ...dto } = content
  return dto
}

export default class LocalArtifactProvider extends Service implements ArtifactService {
  static Config: z<Config> = Config

  private readonly root: string
  private readonly maxBytes: number

  constructor(ctx: Context, config: Config) {
    super(ctx, 'nookArtifacts')
    this.root = resolve(config.root)
    this.maxBytes = config.maxBytes
  }

  async write(request: WriteArtifactRequest): Promise<ArtifactDto> {
    const name = request.name.trim()
    const mediaType = request.mediaType.trim()
    if (
      name.length === 0 ||
      name.length > 180 ||
      mediaType.length === 0 ||
      mediaType.length > 120 ||
      !SAFE_ID.test(request.projectId)
    ) {
      throw new ArtifactError('INVALID_ARTIFACT', 'artifact name, media type, or project id is invalid')
    }
    const maxEncodedLength = 4 * Math.ceil(this.maxBytes / 3)
    if (request.dataBase64.length > maxEncodedLength) {
      throw new ArtifactError('INVALID_ARTIFACT', `artifact exceeds the ${this.maxBytes} byte provider limit`)
    }
    if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(request.dataBase64)) {
      throw new ArtifactError('INVALID_ARTIFACT', 'artifact data is not canonical base64')
    }
    const byteLength = Buffer.from(request.dataBase64, 'base64').byteLength
    if (byteLength > this.maxBytes) {
      throw new ArtifactError('INVALID_ARTIFACT', `artifact exceeds the ${this.maxBytes} byte provider limit`)
    }
    const content: ArtifactContentDto = {
      id: randomUUID(),
      projectId: request.projectId,
      name,
      mediaType,
      byteLength,
      createdAt: new Date().toISOString(),
      dataBase64: request.dataBase64,
    }
    const directory = join(this.root, request.projectId)
    try {
      await mkdir(directory, { recursive: true })
      await writeFile(join(directory, `${content.id}.json`), `${JSON.stringify(content)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
      })
    } catch (error: unknown) {
      throw new ArtifactError('ARTIFACT_STORAGE_FAILED', 'failed to persist artifact', { cause: error })
    }
    return metadata(content)
  }

  async read(artifactId: ArtifactId): Promise<ArtifactContentDto | undefined> {
    if (!SAFE_ID.test(artifactId)) return undefined
    for (const projectId of await this.projectDirectories()) {
      try {
        const raw = await readFile(join(this.root, projectId, `${artifactId}.json`), 'utf8')
        return this.parseContent(raw)
      } catch (error: unknown) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw new ArtifactError('ARTIFACT_STORAGE_FAILED', 'failed to read artifact', { cause: error })
        }
      }
    }
    return undefined
  }

  async list(projectId: ProjectId): Promise<readonly ArtifactDto[]> {
    if (!SAFE_ID.test(projectId)) return []
    try {
      const names = await readdir(join(this.root, projectId))
      const rows = await Promise.all(
        names
          .filter(name => name.endsWith('.json'))
          .map(async name => {
            const content = this.parseContent(await readFile(join(this.root, projectId, name), 'utf8'))
            return metadata(content)
          }),
      )
      return rows.sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw new ArtifactError('ARTIFACT_STORAGE_FAILED', 'failed to list artifacts', { cause: error })
    }
  }

  async delete(artifactId: ArtifactId): Promise<void> {
    const found = await this.read(artifactId)
    if (found === undefined) throw new ArtifactError('ARTIFACT_NOT_FOUND', `artifact ${artifactId} does not exist`)
    try {
      writeRecoveryRecord(`${this.root}.backups`, 'delete-artifact', found)
      await rm(join(this.root, found.projectId, `${artifactId}.json`))
    } catch (error: unknown) {
      throw new ArtifactError('ARTIFACT_STORAGE_FAILED', 'failed to delete artifact', { cause: error })
    }
  }

  private async projectDirectories(): Promise<readonly string[]> {
    try {
      return (await readdir(this.root, { withFileTypes: true }))
        .filter(entry => entry.isDirectory() && SAFE_ID.test(entry.name))
        .map(entry => entry.name)
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
      throw new ArtifactError('ARTIFACT_STORAGE_FAILED', 'failed to inspect artifact store', { cause: error })
    }
  }

  private parseContent(raw: string): ArtifactContentDto {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null) throw new Error('invalid artifact shape')
    const content = value as Partial<ArtifactContentDto>
    if (
      typeof content.id !== 'string' ||
      !SAFE_ID.test(content.id) ||
      typeof content.projectId !== 'string' ||
      !SAFE_ID.test(content.projectId) ||
      typeof content.name !== 'string' ||
      content.name.length === 0 ||
      content.name.length > 180 ||
      typeof content.mediaType !== 'string' ||
      content.mediaType.length === 0 ||
      content.mediaType.length > 120 ||
      typeof content.byteLength !== 'number' ||
      !Number.isSafeInteger(content.byteLength) ||
      content.byteLength < 0 ||
      content.byteLength > this.maxBytes ||
      typeof content.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(content.createdAt)) ||
      typeof content.dataBase64 !== 'string' ||
      content.dataBase64.length > 4 * Math.ceil(this.maxBytes / 3) ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(content.dataBase64) ||
      Buffer.from(content.dataBase64, 'base64').byteLength !== content.byteLength
    ) {
      throw new Error('invalid artifact shape')
    }
    return content as ArtifactContentDto
  }
}
