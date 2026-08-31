export type BrowserOwnerId = string

export type BrowserLoadState = 'load' | 'domcontentloaded' | 'networkidle'

export interface BrowserNodeDto {
  readonly role: string
  readonly name: string
  readonly ref?: string
  readonly level?: number
  readonly checked?: boolean
  readonly selected?: boolean
  readonly disabled?: boolean
  readonly href?: string
  readonly children: readonly BrowserNodeDto[]
}

export interface BrowserSnapshotDto {
  readonly url: string
  readonly title: string
  readonly nodes: readonly BrowserNodeDto[]
  readonly totalRefs: number
  readonly truncated: boolean
}

export interface BrowserScreenshotDto {
  readonly mimeType: 'image/png'
  readonly dataBase64: string
}

export interface BrowserService {
  navigate(
    ownerId: BrowserOwnerId,
    url: string,
    waitUntil?: BrowserLoadState,
    signal?: AbortSignal,
  ): Promise<BrowserSnapshotDto>
  snapshot(ownerId: BrowserOwnerId, interactiveOnly?: boolean): Promise<BrowserSnapshotDto>
  click(ownerId: BrowserOwnerId, ref: string, signal?: AbortSignal): Promise<BrowserSnapshotDto>
  screenshot(
    ownerId: BrowserOwnerId,
    options?: { readonly fullPage?: boolean; readonly ref?: string },
    signal?: AbortSignal,
  ): Promise<BrowserScreenshotDto>
  release(ownerId: BrowserOwnerId): Promise<void>
}

export type BrowserCapabilityErrorCode = 'BROWSER_UNAVAILABLE' | 'BROWSER_OPERATION_FAILED'

export class BrowserCapabilityError extends Error {
  readonly name = 'BrowserCapabilityError'

  constructor(
    readonly code: BrowserCapabilityErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}
