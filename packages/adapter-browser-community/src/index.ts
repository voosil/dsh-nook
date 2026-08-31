import { Context, Service } from '@deepseek-ai/cordis'
import type {} from 'dsh-browser-playwright/service'
import type { BrowserNode, BrowserSnapshot } from 'dsh-browser-playwright'
import {
  BrowserCapabilityError,
  type BrowserLoadState,
  type BrowserNodeDto,
  type BrowserScreenshotDto,
  type BrowserService,
  type BrowserSnapshotDto,
} from '@nook-dsh/capability-browser'

declare module '@deepseek-ai/cordis' {
  interface Context {
    nookBrowser: BrowserService
  }
}

export const inject = ['browser']

function projectNode(node: BrowserNode): BrowserNodeDto {
  return {
    role: node.role,
    name: node.name,
    ...(node.ref === undefined ? {} : { ref: node.ref }),
    ...(node.level === undefined ? {} : { level: node.level }),
    ...(node.checked === undefined ? {} : { checked: node.checked }),
    ...(node.selected === undefined ? {} : { selected: node.selected }),
    ...(node.disabled === undefined ? {} : { disabled: node.disabled }),
    ...(node.href === undefined ? {} : { href: node.href }),
    children: node.children.map(projectNode),
  }
}

function projectSnapshot(snapshot: BrowserSnapshot): BrowserSnapshotDto {
  return {
    url: snapshot.url,
    title: snapshot.title,
    nodes: snapshot.nodes.map(projectNode),
    totalRefs: snapshot.totalRefs,
    truncated: snapshot.truncated,
  }
}

function operationError(action: string, error: unknown): BrowserCapabilityError {
  const message = error instanceof Error ? error.message : String(error)
  return new BrowserCapabilityError('BROWSER_OPERATION_FAILED', `${action} failed: ${message}`, { cause: error })
}

export default class CommunityBrowserAdapter extends Service implements BrowserService {
  static inject = inject

  private readonly owners = new Set<string>()
  private readonly browser: Context['browser']

  constructor(ctx: Context) {
    super(ctx, 'nookBrowser')
    this.browser = ctx.browser
    ctx.effect(
      () => async () => {
        const owners = [...this.owners]
        this.owners.clear()
        await Promise.allSettled(owners.map(owner => ctx.browser.disposeOwner(owner)))
      },
      'nook-browser: release owned sessions',
    )
  }

  async navigate(
    ownerId: string,
    url: string,
    waitUntil: BrowserLoadState = 'domcontentloaded',
    signal?: AbortSignal,
  ): Promise<BrowserSnapshotDto> {
    try {
      this.owners.add(ownerId)
      return projectSnapshot(await (await this.browser.acquire(ownerId, signal)).navigate(url, waitUntil, signal))
    } catch (error: unknown) {
      throw operationError('navigate', error)
    }
  }

  async snapshot(ownerId: string, interactiveOnly = false): Promise<BrowserSnapshotDto> {
    try {
      this.owners.add(ownerId)
      return projectSnapshot(await (await this.browser.acquire(ownerId)).snapshot({ interactiveOnly }))
    } catch (error: unknown) {
      throw operationError('snapshot', error)
    }
  }

  async click(ownerId: string, ref: string, signal?: AbortSignal): Promise<BrowserSnapshotDto> {
    try {
      this.owners.add(ownerId)
      return projectSnapshot(await (await this.browser.acquire(ownerId, signal)).click(ref, signal))
    } catch (error: unknown) {
      throw operationError('click', error)
    }
  }

  async screenshot(
    ownerId: string,
    options?: { readonly fullPage?: boolean; readonly ref?: string },
    signal?: AbortSignal,
  ): Promise<BrowserScreenshotDto> {
    try {
      this.owners.add(ownerId)
      const capture = await (await this.browser.acquire(ownerId, signal)).screenshot(options, signal)
      return { mimeType: capture.mime, dataBase64: Buffer.from(capture.bytes).toString('base64') }
    } catch (error: unknown) {
      throw operationError('screenshot', error)
    }
  }

  async release(ownerId: string): Promise<void> {
    this.owners.delete(ownerId)
    await this.browser.disposeOwner(ownerId)
  }
}
