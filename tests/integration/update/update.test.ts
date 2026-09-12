import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Context, Service } from '@deepseek-ai/cordis'
import Registry from '@deepseek-ai/dsh-typert-registry'
import Gateway from '@deepseek-ai/dsh-api-gateway'
import Rpc from '../../../packages/adapter-update-dsh/src/index.ts'
import { unavailable } from '../../../packages/capability-update/src/index.ts'

test('update RPC accepts fixed commands without task coordination, validates input, and disposes', async () => {
  const ctx = new Context()
  const commands: string[] = []
  try {
    await ctx.plugin(Registry)
    await ctx.plugin(Gateway)
    await ctx.plugin(
      class extends Service {
        constructor(ctx: Context) {
          super(ctx, 'nookUpdate')
        }
        async command(command: string) {
          commands.push(command)
          return { ...unavailable, phase: 'idle' }
        }
      },
    )
    const plugin = await ctx.plugin(Rpc)
    const invoke = (method: string, request = {}) =>
      ctx.typertGateway.invoke({ namespace: 'nookUpdateRpc', method, args: { request } }) as Promise<any>
    assert.equal((await invoke('start')).ok, true)
    assert.deepEqual(commands, ['start'])
    await assert.rejects(invoke('start', { command: 'arbitrary shell' }), /boundary validation/)
    await plugin.dispose()
    await assert.rejects(invoke('status'), /withdrawn/)
  } finally {
    await ctx.fiber.dispose()
  }
})
