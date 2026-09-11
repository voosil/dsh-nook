import type { NoteService } from '@nook-dsh/capability-note'
import type { ProjectService } from '@nook-dsh/capability-project'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import { mkdirSync, writeFileSync, readFileSync, chmodSync } from 'node:fs'
import { dirname } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type {} from '@deepseek-ai/dsh-typert-registry'
import type { NookDshService } from '@nook-dsh/dsh-adapter'
import { commandSchema, requestSchema, TaskError, type TaskService } from '@nook-dsh/capability-task'
import type { RefinementService } from '@nook-dsh/capability-refinement'
import type { GenerationService } from '@nook-dsh/capability-generation'
import { descriptors, RPC_PACKAGE, requests, type Request, type Result } from './rpc.js'
declare module '@deepseek-ai/cordis' {
  interface Context {
    nookNotes: NoteService
    nookProjects: ProjectService
    nookTasks: TaskService
    nookRefinement: RefinementService
    nookGeneration: GenerationService
    nookDsh: NookDshService
    nookTasksRpc: TasksRpc
  }
}
export default class TasksRpc extends TypertRemoteService {
  static inject = ['nookNotes', 'nookProjects', 'typert', 'nookTasks', 'nookRefinement', 'nookGeneration', 'nookDsh']
  constructor(ctx: Context, config: { connection: string }) {
    super(ctx, 'nookTasksRpc')
    ctx.effect(() =>
      ctx.typert.register({
        package: RPC_PACKAGE,
        face: 'host',
        schemas: [],
        model: { services: [], events: [], objects: [] },
        invocations: descriptors,
      }),
    )
    ctx.effect(() =>
      ctx.nookDsh.registerTool({
        name: 'nook_task_list',
        description: '查看 Nook 的个人任务、计划、日程、提案及回执。',
        parameters: {},
        outputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: { json: { type: 'string', required: true } },
        },
        render: value => String((value as { json: string }).json),
        execute: async () => ({ json: JSON.stringify(ctx.nookTasks.snapshot()) }),
      }),
    )
    ctx.effect(() =>
      ctx.nookDsh.registerTool({
        name: 'nook_task_command',
        description:
          '管理 Nook 任务。明确交办可直接建立任务；区分提醒、开始和截止。领取成功后才执行，结果包含产物与检查证据。先用 nook_task_list 读取版本。参数 JSON 遵循 Nook task command schema：' +
          JSON.stringify(commandSchema.toJSONSchema()),
        parameters: {
          request_id: { type: 'string', required: true, description: '为本次操作生成稳定 UUID，重试必须复用。' },
          json: { type: 'string', required: true, description: 'Nook TaskCommand JSON。' },
        },
        outputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: { json: { type: 'string', required: true } },
        },
        render: value => String((value as { json: string }).json),
        execute: async args => {
          const requestId = String(args.request_id),
            snapshot = ctx.nookTasks.snapshot(),
            old = snapshot.requests.find(r => r.id === requestId)
          const command = commandSchema.parse(JSON.parse(String(args.json)))
          const receipt = await ctx.nookTasks.submit({
            id: requestId,
            deviceId: snapshot.deviceId,
            createdAt: old?.createdAt ?? new Date().toISOString(),
            command,
          })
          return { json: JSON.stringify({ ...receipt, link: receipt.taskId ? '#nook-task=' + receipt.taskId : null }) }
        },
      }),
    )
    // Local authenticated loopback bridge for stdio MCP and the desktop shell.
    ctx.effect(() => {
      const token = randomUUID() + randomUUID(),
        sockets = new Set<import('node:net').Socket>()
      const server = createServer(socket => {
        sockets.add(socket)
        socket.setTimeout(30000, () => socket.destroy())
        let buffer = ''
        socket.on('data', chunk => {
          buffer += chunk.toString()
          if (buffer.length > 2_000_000) {
            socket.destroy()
            return
          }
          let index: number
          while ((index = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, index)
            buffer = buffer.slice(index + 1)
            void (async () => {
              try {
                const value = JSON.parse(line)
                if (value.token !== token) throw new Error('unauthorized')
                const signal = AbortSignal.timeout(25000)
                let result: unknown
                if (value.method === 'snapshot') result = await this.snapshot({}, signal)
                else if (value.method === 'submit')
                  result = await this.submit(requests.submit.parse(value.request), signal)
                else throw new Error('unsupported')
                socket.write(JSON.stringify({ id: value.id, result }) + '\n')
              } catch {
                socket.write(JSON.stringify({ error: '任务连接请求失败' }) + '\n')
              }
            })()
          }
        })
        socket.on('error', () => socket.destroy())
        socket.once('close', () => sockets.delete(socket))
      })
      server.listen(0, '127.0.0.1', () => {
        const address = server.address()
        if (!address || typeof address === 'string') return
        mkdirSync(dirname(config.connection), { recursive: true })
        writeFileSync(config.connection, JSON.stringify({ port: address.port, token }), { mode: 0o600 })
        chmodSync(config.connection, 0o600)
      })
      return async () => {
        for (const socket of sockets) socket.destroy()
        await new Promise<void>(resolve => server.close(() => resolve()))
        try {
          const old = JSON.parse(readFileSync(config.connection, 'utf8'))
          if (old.token === token) writeFileSync(config.connection, JSON.stringify({ offline: true }), { mode: 0o600 })
        } catch {}
      }
    })
  }
  private async result<T>(signal: AbortSignal, fn: () => T | Promise<T>): Promise<Result<T>> {
    try {
      signal.throwIfAborted()
      return { ok: true, value: await fn() }
    } catch (error) {
      return {
        ok: false,
        error: {
          code: 'TASK_ERROR',
          message: error instanceof TaskError ? error.message : '操作未完成，输入已保留，请检查状态后重试。',
        },
      }
    }
  }
  async sources(_request: Request<'sources'>, signal: AbortSignal) {
    return this.result(signal, async () => {
      const notes: { id: string; title: string }[] = []
      for (let offset = 0; ; offset += 100) {
        const page = await this.ctx.nookNotes.list({ offset, limit: 100 })
        notes.push(
          ...page.notes
            .filter(n => n.source.kind === 'personal')
            .map(n => ({ id: n.id, title: n.title || n.markdown.slice(0, 50) || '无标题笔记' })),
        )
        if (offset + 100 >= page.total) break
      }
      return { notes, projects: (await this.ctx.nookProjects.list()).map(p => ({ id: p.id, name: p.name })) }
    })
  }
  snapshot(_request: Request<'snapshot'>, signal: AbortSignal) {
    return this.result(signal, () => this.ctx.nookTasks.snapshot())
  }
  submit(request: Request<'submit'>, signal: AbortSignal) {
    return this.result(signal, () => this.ctx.nookTasks.submit(requestSchema.parse(request)))
  }
  configure(request: Request<'configure'>, signal: AbortSignal) {
    return this.result(signal, () => this.ctx.nookTasks.configure(request))
  }
  refine(_request: Request<'refine'>, signal: AbortSignal) {
    return this.result(signal, async () => {
      await this.ctx.nookRefinement.tick(Date.now(), true)
      return true
    })
  }
  models(_request: Request<'models'>, signal: AbortSignal) {
    return this.result(signal, () => this.ctx.nookGeneration.models())
  }
}
