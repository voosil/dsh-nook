import { randomUUID } from 'node:crypto'
import { Context, Service } from '@deepseek-ai/cordis'
import { createUserMessage, isHarnessError, type GenerateOptions, type LlmFailure } from '@deepseek-ai/dsh-llm'
import {
  GenerationError,
  type GenerationService,
  type GenerateRequest,
  type ModelDto,
} from '@nook-dsh/capability-generation'

function modelFailure(failure: Pick<LlmFailure, 'code' | 'status'>): GenerationError {
  const messages: Record<string, string> = {
    AUTH: '模型认证失败，请在 DSH 设置中检查 API Key 和模型访问权限。',
    MISSING_CREDENTIAL: '模型尚未配置 API Key，请先在 DSH 设置中配置。',
    INVALID_CREDENTIAL: '模型 API Key 格式无效，请在 DSH 设置中重新填写。',
    NO_ADAPTER: '所选模型服务不可用，请检查 DSH 模型配置后重新选择模型。',
    QUOTA: '模型账户额度不足，请检查余额或切换模型。',
    RATE_LIMIT: '模型请求过于频繁，请稍后重试或切换模型。',
    CONTEXT_WINDOW_EXCEEDED: '资料超过模型上下文上限，请缩小日期范围或选择一个项目。',
    INVALID_REQUEST: '模型拒绝了生成请求，请检查模型配置或缩小资料范围。',
    TIMEOUT: '模型请求超时，请检查连接后重试。',
    TRANSPORT: '模型连接中断，请检查网络和模型服务地址后重试。',
    SERVER: '模型服务暂时异常，请稍后重试或切换模型。',
    EMPTY_RESPONSE: '模型没有返回正文，请重试或切换模型。',
    ABORTED: '模型生成已中止，请重试。',
  }
  const statusCode =
    failure.status === 401 || failure.status === 403
      ? 'AUTH'
      : failure.status === 429
        ? 'RATE_LIMIT'
        : failure.status !== undefined && failure.status >= 500
          ? 'SERVER'
          : ''
  // Provider messages can contain request bodies or credentials; only return Nook copy.
  return new GenerationError(
    (Object.hasOwn(messages, failure.code) ? messages[failure.code] : messages[statusCode]) ??
      '模型生成失败，请检查 DSH 模型配置后重试或切换模型。',
  )
}

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
    try {
      for (const provider of this.ctx.llm.listProviders()) {
        for (const model of await this.ctx.llm.listModels(provider.id))
          models.push({ provider: provider.id, id: model.id, name: `${provider.name} · ${model.name}` })
      }
      return models
    } catch (error) {
      throw modelFailure({ code: isHarnessError(error) ? error.code : 'UNKNOWN' })
    }
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
        sessionId: (request.sessionId ?? `nook-generation-${randomUUID()}`) as NonNullable<
          GenerateOptions['sessionId']
        >,
        system: request.instruction,
        messages: [createUserMessage({ content: [{ type: 'text', text: request.text }], source: { kind: 'user' } })],
        maxTokens: request.maxTokens ?? 6000,
        signal: combined,
      })) {
        combined.throwIfAborted()
        if (chunk.type === 'text-delta') blocks.set(chunk.index, (blocks.get(chunk.index) ?? '') + chunk.text)
        if (chunk.type === 'block-end' && chunk.block.type === 'text') blocks.set(chunk.index, chunk.block.text)
        if (chunk.type === 'finish') {
          if (chunk.reason.kind === 'error') throw modelFailure(chunk.reason.failure)
          if (chunk.reason.kind === 'aborted') throw new GenerationError('模型生成已中止，请重试。')
          if (chunk.reason.kind === 'max-tokens')
            throw new GenerationError('模型输出达到长度上限，未能完整生成。请缩小日期范围、选择一个项目或切换模型。')
          if (chunk.reason.kind !== 'stop') throw new GenerationError('模型输出未完整结束，请重试或切换模型。')
          complete = true
        }
      }
      const text = [...blocks.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, text]) => text)
        .join('')
        .trim()
      combined.throwIfAborted()
      if (!complete || !text) throw new GenerationError('模型没有返回完整正文，请重试或切换模型。')
      return text
    } catch (error) {
      combined.throwIfAborted()
      if (error instanceof GenerationError) throw error
      throw modelFailure({ code: isHarnessError(error) ? error.code : 'UNKNOWN' })
    } finally {
      this.pending.delete(lifetime)
    }
  }
}

export const inject = ['llm']
export function apply(ctx: Context): void {
  ctx.plugin(DshGeneration)
}
