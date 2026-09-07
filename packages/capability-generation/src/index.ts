export interface ModelDto {
  readonly provider: string
  readonly id: string
  readonly name: string
}
export interface GenerateRequest {
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
