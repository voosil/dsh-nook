export interface VideoCandidate {
  readonly id: string
  readonly author: string
  readonly markdown: string
  readonly text: string
  readonly likes: number
  readonly complete: boolean
}
export interface VideoMaterial {
  readonly url: string
  readonly title: string
  readonly author: string
  readonly transcript: string
  readonly candidates: readonly VideoCandidate[]
  readonly warnings: readonly string[]
}
export interface VideoSourceService {
  collect(url: string, notes: boolean, signal: AbortSignal): Promise<VideoMaterial>
}
export interface VideoReviewRequest {
  readonly material: VideoMaterial
  readonly strategy: 'none' | 'local' | 'llm'
  readonly provider: string
  readonly model: string
}
export interface VideoReviewService {
  select(request: VideoReviewRequest, signal: AbortSignal): Promise<VideoCandidate | null>
}
export interface VideoWriterService {
  skills(): Promise<readonly { readonly id: string; readonly name: string }[]>
  write(
    request: {
      readonly title: string
      readonly text: string
      readonly skill: string
      readonly provider: string
      readonly model: string
    },
    signal: AbortSignal,
  ): Promise<string>
}
export interface VideoRequest {
  readonly id: string
  readonly url: string
  readonly projectId: string | null
  readonly strategy: 'none' | 'local' | 'llm'
  readonly write: boolean
  readonly skill: string
  readonly provider: string
  readonly model: string
}
export interface VideoJob {
  readonly id: string
  readonly status: 'running' | 'done' | 'failed' | 'cancelled'
  readonly stage: string
  readonly noteIds: readonly string[]
  readonly warnings: readonly string[]
  readonly error: string | null
  readonly updatedAt: string
}
export class VideoError extends Error {
  readonly code = 'VIDEO_ERROR'
}
