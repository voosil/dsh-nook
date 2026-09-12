import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

function parsePids(output) {
  return [
    ...new Set(
      output
        .split(/\s+/)
        .filter(Boolean)
        .map(Number)
        .filter(pid => Number.isSafeInteger(pid) && pid > 0 && pid !== process.pid),
    ),
  ]
}

export async function findListeningPids(port) {
  try {
    if (process.platform === 'win32') {
      const script = `(Get-NetTCPConnection -State Listen -LocalPort ${port} -ErrorAction SilentlyContinue).OwningProcess`
      const { stdout } = await execFileAsync(
        'powershell.exe',
        ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script],
        { windowsHide: true, timeout: 10_000 },
      )
      return parsePids(stdout)
    }
    const { stdout } = await execFileAsync('lsof', ['-nP', `-tiTCP:${port}`, '-sTCP:LISTEN'])
    return parsePids(stdout)
  } catch (error) {
    if (error?.code === 1) return []
    if (error?.code === 'ENOENT') {
      throw new Error(
        `cannot release port ${port}: ${process.platform === 'win32' ? 'PowerShell' : 'lsof'} is unavailable`,
        {
          cause: error,
        },
      )
    }
    throw new Error(`failed to inspect port ${port}`, { cause: error })
  }
}

function sendSignal(pid, signal) {
  try {
    process.kill(pid, signal)
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error
  }
}

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

export async function releasePort(
  port,
  { find = findListeningPids, signal = sendSignal, wait = sleep, graceMs = 1500, pollMs = 100 } = {},
) {
  const initial = await find(port)
  if (initial.length === 0) return []

  for (const pid of initial) signal(pid, 'SIGTERM')
  const deadline = Date.now() + graceMs
  let remaining = initial
  while (remaining.length > 0 && Date.now() < deadline) {
    await wait(pollMs)
    remaining = await find(port)
  }

  if (remaining.length > 0) {
    for (const pid of remaining) signal(pid, 'SIGKILL')
    await wait(pollMs)
    remaining = await find(port)
  }
  if (remaining.length > 0) {
    throw new Error(`port ${port} is still occupied by PID ${remaining.join(', ')}`)
  }
  return initial
}
