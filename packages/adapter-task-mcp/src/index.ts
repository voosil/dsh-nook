#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import { createConnection } from 'node:net'
import { randomUUID } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { commandSchema, snapshotSchema, receiptSchema } from '@nook-dsh/capability-task'

export async function callBridge(file: string, method: string, request: unknown = {}) {
  const connection = JSON.parse(await readFile(file, 'utf8'))
  if (
    !Number.isInteger(connection.port) ||
    connection.port < 1 ||
    connection.port > 65535 ||
    typeof connection.token !== 'string'
  )
    throw new Error('Nook 后台未运行')
  return new Promise<unknown>((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port: connection.port })
    let buffer = ''
    let settled = false
    const done = (error?: Error, result?: unknown) => {
      if (settled) return
      settled = true
      socket.destroy()
      error ? reject(error) : resolve(result)
    }
    socket.setTimeout(30000, () => done(new Error('等待主机响应超时')))
    socket.once('connect', () =>
      socket.write(JSON.stringify({ id: randomUUID(), token: connection.token, method, request }) + '\n'),
    )
    socket.on('data', chunk => {
      buffer += chunk.toString()
      if (buffer.length > 8_000_000) return done(new Error('任务响应过大'))
      if (buffer.includes('\n'))
        try {
          const value = JSON.parse(buffer.slice(0, buffer.indexOf('\n')))
          if (!value.result?.ok) done(new Error(value.result?.error?.message ?? '任务请求失败'))
          else done(undefined, value.result.value)
        } catch {
          done(new Error('任务响应无效'))
        }
    })
    socket.on('error', error => done(error))
    socket.once('end', () => done(new Error('任务连接已关闭')))
  })
}
export async function startMcp(file: string) {
  const server = new McpServer({ name: 'nook-tasks', version: '0.1.0' })
  server.registerTool('nook_task_list', { description: '查看 Nook 任务、计划、提案、运行与操作回执。' }, async () => ({
    content: [{ type: 'text', text: JSON.stringify(snapshotSchema.parse(await callBridge(file, 'snapshot'))) }],
  }))
  server.registerTool(
    'nook_task_command',
    {
      description:
        '提交 Nook 任务操作。pending 表示尚未获得执行授权；claim 返回 applied 和 token 后才能执行。执行期间每分钟 heartbeat，完成后 report。',
      inputSchema: { requestId: z.string(), command: commandSchema },
    },
    async ({ requestId, command }) => {
      const snapshot = snapshotSchema.parse(await callBridge(file, 'snapshot'))
      const old = snapshot.requests.find(r => r.id === requestId)
      const receipt = receiptSchema.parse(
        await callBridge(file, 'submit', {
          id: requestId,
          deviceId: snapshot.deviceId,
          createdAt: old?.createdAt ?? new Date().toISOString(),
          command,
        }),
      )
      return { content: [{ type: 'text', text: JSON.stringify(receipt) }] }
    },
  )
  await server.connect(new StdioServerTransport())
  const stop = () => {
    void server.close()
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const file = process.argv[2] ?? process.env.NOOK_TASK_CONNECTION
  if (!file) throw new Error('请提供 Nook task-connection.json 的绝对路径')
  await startMcp(file)
}
