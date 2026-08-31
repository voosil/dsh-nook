import { Context, Service } from '@deepseek-ai/cordis'
import { defineTool, type ParameterSchemaSpec, type ToolDefinition, type ValueSchemaSpec } from '@deepseek-ai/dsh-tools'

export interface NookToolSpec {
  readonly name: string
  readonly description: string
  readonly parameters: ParameterSchemaSpec
  readonly outputSchema: ValueSchemaSpec
  readonly timeoutMs?: number
  execute(args: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<unknown>
  render(value: unknown): string
}

export interface NookDshService {
  registerTool(spec: NookToolSpec): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    nookDsh: NookDshService
  }
}

export const inject = ['tools']

// TypeScript 6 expands defineTool's recursive schema inference past its stack
// limit for an adapter-owned dynamic schema. Runtime validation still goes
// through the official compiler; this cast only narrows the call signature.
const compileTool = defineTool as unknown as (options: unknown) => ToolDefinition

export default class DshAdapter extends Service implements NookDshService {
  static inject = inject
  private readonly registerDefinition: (tool: ToolDefinition) => () => void

  constructor(ctx: Context) {
    super(ctx, 'nookDsh')
    this.registerDefinition = tool => ctx.tools.register(tool)
  }

  registerTool(spec: NookToolSpec): () => void {
    const options = {
      name: spec.name,
      description: spec.description,
      parameters: spec.parameters,
      output: {
        schema: spec.outputSchema,
        render: (_args: unknown, value: unknown) => [{ type: 'text', text: spec.render(value) }],
      },
      ...(spec.timeoutMs === undefined ? {} : { timeoutMs: spec.timeoutMs }),
      execute: (args: Readonly<Record<string, unknown>>, exec: { signal: AbortSignal }) =>
        spec.execute(args, exec.signal),
    }
    return this.registerDefinition(compileTool(options))
  }
}
