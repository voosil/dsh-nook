import { resolve } from 'node:path'

export const DEFAULT_DEV_PORT = '3080'

function normalizedArgs(inputArgs) {
  const args = [...inputArgs]
  if (args[0] === '--') args.shift()
  return args
}

export function resolveDevPort(inputArgs) {
  const args = normalizedArgs(inputArgs)
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]
    if (argument === '--port') return parsePort(args[index + 1])
    if (argument.startsWith('--port=')) return parsePort(argument.slice('--port='.length))
  }
  return Number(DEFAULT_DEV_PORT)
}

function parsePort(value) {
  if (typeof value !== 'string' || !/^\d+$/.test(value)) return undefined
  const port = Number(value)
  return port >= 0 && port <= 65_535 ? port : undefined
}

export function createProfileArgs(
  bin,
  root,
  inputArgs,
  { profile = 'nook', defaultPort = DEFAULT_DEV_PORT, patches = [] } = {},
) {
  const appArgs = normalizedArgs(inputArgs)
  const safeUi = appArgs.indexOf('--safe-ui')
  const dshArgs = [bin, '--profile', profile]
  for (const patch of patches) dshArgs.push('--patch', patch)

  if (safeUi !== -1) {
    appArgs.splice(safeUi, 1)
    dshArgs.push('--patch', resolve(root, 'dev/patches/safe-ui.cordis.yml'))
  }

  dshArgs.push('--no-open')
  if (!appArgs.some(argument => argument === '--port' || argument.startsWith('--port='))) {
    dshArgs.push('--port', String(defaultPort))
  }
  return [...dshArgs, ...appArgs]
}
