import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import { ProjectError, type ProjectId, type ProjectService } from '@nook-dsh/capability-project'
import type { ArtifactDto, ArtifactService } from '@nook-dsh/capability-artifact'
import type { BrowserService, BrowserSnapshotDto } from '@nook-dsh/capability-browser'

export interface PreviewResultDto {
  readonly projectId: ProjectId
  readonly url: string
  readonly title: string
  readonly snapshot: BrowserSnapshotDto
  readonly screenshot: ArtifactDto
}

export interface PreviewFeatureService {
  capture(projectId: ProjectId, url: string, fullPage?: boolean, signal?: AbortSignal): Promise<PreviewResultDto>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    nookProjects: ProjectService
    nookArtifacts: ArtifactService
    nookBrowser: BrowserService
    nookPreview: PreviewFeatureService
  }
}

export const inject = ['nookProjects', 'nookArtifacts', 'nookBrowser']

export default class PreviewFeature extends Service implements PreviewFeatureService {
  static inject = inject
  private readonly projects: ProjectService
  private readonly artifacts: ArtifactService
  private readonly browser: BrowserService

  constructor(ctx: Context) {
    super(ctx, 'nookPreview')
    this.projects = ctx.nookProjects
    this.artifacts = ctx.nookArtifacts
    this.browser = ctx.nookBrowser
  }

  async capture(projectId: ProjectId, url: string, fullPage = true, signal?: AbortSignal): Promise<PreviewResultDto> {
    const project = await this.projects.get(projectId)
    if (project === undefined) throw new ProjectError('PROJECT_NOT_FOUND', `project ${projectId} does not exist`)
    const ownerId = `nook-preview:${projectId}:${randomUUID()}`
    try {
      const snapshot = await this.browser.navigate(ownerId, url, 'domcontentloaded', signal)
      const capture = await this.browser.screenshot(ownerId, { fullPage }, signal)
      const safeTitle =
        snapshot.title
          .trim()
          .replace(/[^a-z0-9._-]+/gi, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 80) || 'preview'
      const screenshot = await this.artifacts.write({
        projectId,
        name: `${safeTitle}.png`,
        mediaType: capture.mimeType,
        dataBase64: capture.dataBase64,
      })
      return { projectId, url: snapshot.url, title: snapshot.title, snapshot, screenshot }
    } finally {
      await this.browser.release(ownerId).catch(() => undefined)
    }
  }
}
