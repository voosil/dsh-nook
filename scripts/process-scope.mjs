import { spawn } from 'node:child_process'
import { once } from 'node:events'

/** Own child process groups so Ctrl+C also stops builds and runtime workers. */
export class ProcessScope {
  children = new Set()

  spawn(command, args, options = {}) {
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
    const signal = name => {
      try {
        if (process.platform === 'win32') child.kill(name)
        else process.kill(-child.pid, name)
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
