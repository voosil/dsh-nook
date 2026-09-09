export interface ModelDto {
  readonly provider: string
  readonly id: string
  readonly name: string
}
export interface GenerateRequest {
  /** Stable identity shared by all model calls within one workflow. */
  readonly sessionId?: string
  readonly provider: string
  readonly model: string
  readonly instruction: string
  readonly text: string
  readonly maxTokens?: number
}
export interface GenerationService {
  models(): Promise<readonly ModelDto[]>
  generate(request: GenerateRequest, signal: AbortSignal): Promise<string>
}

/** A user-facing generation failure with a Nook-owned, safe message. */
export class GenerationError extends Error {
  readonly code = 'GENERATION_ERROR'
}
