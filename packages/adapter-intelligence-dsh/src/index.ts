import { Context, Service } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { GenerationService, GenerateRequest, ModelDto } from '@nook-dsh/capability-generation'

declare module '@deepseek-ai/cordis' {
  interface Context {
    nookGeneration: GenerationService
  }
}

class DshGeneration extends Service implements GenerationService {
  static inject = ['llm']
  private readonly pending = new Set<AbortController>()
  constructor(ctx: Context) {
    super(ctx, 'nookGeneration')
    ctx.effect(() => () => {
      for (const controller of this.pending) controller.abort()
      this.pending.clear()
    })
  }
  async models(): Promise<readonly ModelDto[]> {
    const models: ModelDto[] = []
    for (const provider of this.ctx.llm.listProviders()) {
      for (const model of await this.ctx.llm.listModels(provider.id))
        models.push({ provider: provider.id, id: model.id, name: `${provider.name} · ${model.name}` })
    }
    return models
  }
  async generate(request: GenerateRequest, signal: AbortSignal): Promise<string> {
    signal.throwIfAborted()
    const lifetime = new AbortController()
    this.pending.add(lifetime)
    const combined = AbortSignal.any([signal, lifetime.signal])
    const blocks = new Map<number, string>()
    let complete = false
    try {
      for await (const chunk of this.ctx.llm.stream({
        provider: request.provider,
        model: request.model,
        system: request.instruction,
        messages: [createUserMessage({ content: [{ type: 'text', text: request.text }], source: { kind: 'user' } })],
        maxTokens: request.maxTokens ?? 6000,
        signal: combined,
      })) {
        combined.throwIfAborted()
        if (chunk.type === 'text-delta') blocks.set(chunk.index, (blocks.get(chunk.index) ?? '') + chunk.text)
        if (chunk.type === 'block-end' && chunk.block.type === 'text') blocks.set(chunk.index, chunk.block.text)
        if (chunk.type === 'finish') {
          if (chunk.reason.kind !== 'stop') throw new Error('模型输出未完整结束，请重试或缩小资料范围。')
          complete = true
        }
      }
      const text = [...blocks.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, text]) => text)
        .join('')
        .trim()
      if (!complete || !text) throw new Error('模型没有返回完整正文。')
      return text
    } finally {
      this.pending.delete(lifetime)
    }
  }
}

export const inject = ['llm']
export function apply(ctx: Context): void {
  ctx.plugin(DshGeneration)
}
