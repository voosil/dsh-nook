import assert from 'node:assert/strict'
import { closeSync, openSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'

// Run with the shipped Node; all external imports resolve from the shipped
// Profile. Only disposable scratch data is written, never installed packages.
const [profile, scratch] = process.argv.slice(2)
assert.ok(profile && scratch)
await mkdir(scratch, { recursive: true })
const require = createRequire(join(resolve(profile), 'package.json'))
const base = createRequire(require.resolve('@deepseek-ai/dsh-base/package.json'))
const persistence = createRequire(base.resolve('@deepseek-ai/dsh-session-persistence-jsonl/package.json'))
const { flockSync } = persistence('fs-ext')
const fd = openSync(join(scratch, 'native-lock'), 'wx', 0o600)
try {
  flockSync(fd, 'exnb')
  flockSync(fd, 'un')
} finally {
  closeSync(fd)
}
const db = new DatabaseSync(':memory:')
try {
  db.exec("CREATE VIRTUAL TABLE notes USING fts5(body); INSERT INTO notes VALUES ('desktop')")
  assert.equal(db.prepare("SELECT body FROM notes WHERE notes MATCH 'desktop'").get().body, 'desktop')
} finally {
  db.close()
}
const { Context } = await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href)
const { default: LocalSubprocessRuntime } = await import(
  pathToFileURL(base.resolve('@deepseek-ai/dsh-subprocess-local')).href
)
const ctx = new Context()
let terminal
let output = ''
const consume = chunk => {
  output += chunk.toString()
}
try {
  await ctx.plugin(LocalSubprocessRuntime)
  assert.ok(ctx.subprocess instanceof LocalSubprocessRuntime)
  const process = ctx.subprocess.spawn({
    argv: ['/bin/sh', '-c', 'printf native-shell'],
    cwd: scratch,
    stdio: { stdin: 'ignore', stdout: { maxBytes: 1024 }, stderr: { maxBytes: 1024 } },
    graceMs: 1000,
  })
  assert.equal((await process.done).exitCode, 0)
  assert.equal(process.collected.stdout.readFrom(0).text, 'native-shell')
  assert.equal(await process.waitForExit(AbortSignal.timeout(5000)), true)
  terminal = await ctx.subprocess.spawnTerminal({
    argv: ['/bin/sh', '-c', 'printf native-pty; exec /bin/sleep 30'],
    cwd: scratch,
    rows: 24,
    cols: 80,
    graceMs: 1000,
  })
  terminal.output.on('data', consume)
  const deadline = Date.now() + 5000
  while (!output.includes('native-pty') && Date.now() < deadline) await delay(20)
  assert.match(output, /native-pty/)
} finally {
  await ctx.fiber.dispose()
  terminal?.output.off('data', consume)
}
if (terminal) assert.throws(() => process.kill(terminal.pid, 0), { code: 'ESRCH' })
console.log('Verified shipped Node, fs-ext locks, SQLite FTS5, DSH shell, PTY, and provider disposal.')
