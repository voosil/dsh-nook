import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { join } from 'node:path'
import { corepackCommand } from './corepack-command.mjs'

/** Own child process groups so Ctrl+C also stops builds and runtime workers. */
export class ProcessScope {
  children = new Set()

  spawn(command, args, options = {}) {
    if (command === 'corepack') [command, args] = corepackCommand(args, { env: options.env ?? process.env })
    const child = spawn(command, args, { stdio: 'inherit', ...options, detached: process.platform !== 'win32' })
    this.children.add(child)
    child.once('exit', () => this.children.delete(child))
    child.once('error', () => this.children.delete(child))
    return child
  }

  async run(command, args, options = {}) {
    const { capture, ...spawnOptions } = options
    const child = this.spawn(command, args, {
      ...spawnOptions,
      ...(capture ? { stdio: ['ignore', 'pipe', 'pipe'] } : {}),
    })
    let stdout = ''
    let stderr = ''
    if (capture) {
      child.stdout.on('data', chunk => {
        stdout += chunk.toString()
      })
      child.stderr.on('data', chunk => {
        stderr += chunk.toString()
      })
    }
    const [code, signal] = await once(child, 'exit')
    if (code !== 0) throw new Error(`${command} exited with ${code ?? signal}\n${stdout}${stderr}`)
    return { stdout, stderr, code }
  }

  async stop(child) {
    if (!this.children.has(child)) return
    const exited = once(child, 'exit')
    if (process.platform === 'win32') {
      const killer = spawn(
        join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/taskkill.exe'),
        ['/PID', String(child.pid), '/T', '/F'],
        { windowsHide: true, stdio: 'ignore' },
      )
      const [code] = await once(killer, 'exit')
      if (code !== 0 && this.children.has(child)) throw new Error(`Could not stop owned process tree ${child.pid}`)
      await exited
      return
    }
    const signal = name => {
      try {
        process.kill(-child.pid, name)
      } catch (error) {
        if (error.code !== 'ESRCH') throw error
      }
    }
    signal('SIGTERM')
    const timer = setTimeout(() => signal('SIGKILL'), 5_000)
    try {
      await exited
    } finally {
      clearTimeout(timer)
    }
  }

  async dispose() {
    await Promise.all([...this.children].map(child => this.stop(child)))
  }
}
