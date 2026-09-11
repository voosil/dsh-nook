import type { ModelRoute, TaskRun, TaskReport, ReviewResult } from '@nook-dsh/capability-task'
export interface ExecutionRequest {
  run: TaskRun
  route: ModelRoute
  cwd: string
  context: string
}
export interface ExecutionResult {
  report?: TaskReport
  review?: ReviewResult
  error?: string
}
export interface ExecutionService {
  run(request: ExecutionRequest, signal: AbortSignal): Promise<ExecutionResult>
  cancel(runId: string): Promise<void>
  recover(run: TaskRun): Promise<ExecutionResult | null>
}
