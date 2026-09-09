import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { constants } from 'node:fs'
import { spawn } from 'node:child_process'
import { resolve, delimiter } from 'node:path'
import { corepackCommand } from '../shared/corepack-command.mjs'

export const ROOT = resolve(import.meta.dirname, '../..')
export const DEV_HOME = resolve(ROOT, '.dsh-dev')
export const DEV_AGENTS_HOME = resolve(DEV_HOME, 'agents')
export const PROFILE_DIR = resolve(DEV_HOME, 'profiles', 'nook')
export const DSH_VERSION = '0.1.3-alpha.2'
export const COMMUNITY_BROWSER_VERSION = '0.1.1'
export const PNPM_VERSION = '12.1.0'

export const LOCAL_PACKAGES = [
  'capability-sync',
  'storage-sync',
  'adapter-sync-webdav',
  'feature-sync',
  'adapter-sync-dsh',

  'storage-backup',
  'adapter-knowledge-dsh',
  'ui-knowledge',

  'capability-video',
  'adapter-video-platform',
  'provider-video-editor',
  'feature-video',

  'capability-generation',
  'adapter-intelligence-dsh',
  'feature-reflection',

  'capability-note',
  'capability-knowledge',
  'provider-notebook-local',
  'feature-notes',
  'adapter-notes-dsh',
  'ui-notes',

  'capability-project',
  'capability-browser',
  'capability-artifact',
  'provider-project-local',
  'provider-artifact-local',
  'adapter-browser-community',
  'feature-project',
  'feature-agent',
  'feature-preview',
  'ui-project',
  'ui-sidebar',
  'dsh-adapter',
  'dsh-compat',
  'app-all',
]

export function assertIsolatedHome(home) {
  const expected = resolve(ROOT, '.dsh-dev')
  if (resolve(home) !== expected) throw new Error(`refusing non-isolated DSH_HOME: ${home}`)
}

export async function exists(file) {
  try {
    await access(file, constants.F_OK)
    return true
  } catch {
    return false
  }
}

/** Fresh Profiles must use the same verified external runtime as the repository lockfile. */
export async function pinnedRuntimeOverrides() {
  const lock = await readFile(resolve(ROOT, 'pnpm-lock.yaml'), 'utf8')
  const overrides = {}
  for (const match of lock.matchAll(/^  '(@deepseek-ai\/[^@']+)@(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)':$/gm)) {
    const [, name, version] = match
    if (overrides[name] && overrides[name] !== version) throw new Error(`ambiguous runtime pin: ${name}`)
    overrides[name] = version
  }
  if (overrides['@deepseek-ai/dsh'] !== DSH_VERSION || overrides['@deepseek-ai/cordis'] !== '4.0.2')
    throw new Error('runtime lockfile does not match the verified DSH/Cordis baseline')
  return overrides
}

export async function writeDevProfile() {
  assertIsolatedHome(DEV_HOME)
  await mkdir(PROFILE_DIR, { recursive: true })
  await mkdir(DEV_AGENTS_HOME, { recursive: true })
  await writeFile(
    resolve(DEV_HOME, 'pnpm-workspace.yaml'),
    [
      'packages:',
      '  - profiles/*',
      '',
      'overrides:',
      ...Object.entries(await pinnedRuntimeOverrides()).map(([name, version]) => `  '${name}': '${version}'`),
      '',
      'allowBuilds:',
      "  '@deepseek-ai/dsh-subprocess-local': true",
      "  '@google/genai': true",
      '  fs-ext: true',
      '  koffi: true',
      '  node-pty: true',
      '  protobufjs: true',
      '',
    ].join('\n'),
  )
  const dependencies = {
    '@deepseek-ai/dsh': DSH_VERSION,
    '@deepseek-ai/dsh-base': DSH_VERSION,
    '@deepseek-ai/dsh-web-app': DSH_VERSION,
    'dsh-browser-playwright': COMMUNITY_BROWSER_VERSION,
  }
  for (const directory of LOCAL_PACKAGES) {
    const manifest = JSON.parse(await readFile(resolve(ROOT, 'packages', directory, 'package.json'), 'utf8'))
    dependencies[manifest.name] = `link:../../../packages/${directory}`
  }
  const manifest = {
    name: 'nook-dsh-profile',
    version: '0.1.0',
    private: true,
    packageManager: 'pnpm@12.1.0',
    dependencies,
    dsh: {
      profile: {
        bundles: [
          '@deepseek-ai/dsh-base',
          '@deepseek-ai/dsh-web-app',
          '@nook-dsh/adapter-browser-community',
          '@nook-dsh/app-all',
        ],
      },
    },
  }
  await writeFile(resolve(PROFILE_DIR, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  // Profile patches are user configuration, even in the repository's usage home.
  if (!(await exists(resolve(PROFILE_DIR, 'cordis.patch.yml')))) {
    await writeFile(resolve(PROFILE_DIR, 'cordis.patch.yml'), '[]\n', { flag: 'wx' })
  }
  if (!(await exists(resolve(DEV_HOME, 'cordis.patch.yml')))) {
    await writeFile(resolve(DEV_HOME, 'cordis.patch.yml'), '[]\n')
  }
  return manifest
}

export function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? ROOT,
      env: { ...process.env, ...options.env },
      stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    })
    let stdout = ''
    let stderr = ''
    if (options.capture) {
      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', chunk => {
        stdout += chunk
      })
      child.stderr.on('data', chunk => {
        stderr += chunk
      })
    }
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (code === 0 || options.allowedExitCodes?.includes(code)) return resolvePromise({ stdout, stderr, code })
      reject(new Error(`${command} ${args.join(' ')} exited with ${code ?? signal}\n${stdout}${stderr}`))
    })
  })
}

export async function installProfile(profileDir = PROFILE_DIR) {
  return runPnpm(['install', '--dir', profileDir, '--no-frozen-lockfile'])
}

export function runPnpm(args, options = {}) {
  const [command, commandArgs] = corepackCommand([`pnpm@${PNPM_VERSION}`, ...args], {
    env: { ...process.env, ...options.env },
  })
  return run(command, commandArgs, {
    ...options,
    env: { CI: 'true', ...options.env },
  })
}

export function dshBin() {
  return resolve(ROOT, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
}

export function devRuntimeEnv() {
  return {
    PATH: `${resolve(DEV_HOME, 'video-runtime', process.platform === 'win32' ? 'Scripts' : 'bin')}${delimiter}${process.env.PATH ?? ''}`,
    DSH_HOME: DEV_HOME,
    DSH_AGENTS_HOME: DEV_AGENTS_HOME,
    DSH_TELEMETRY_MODE: 'DISABLED',
    // DSH app boot always watches Profile/Home patches. Polling avoids native
    // recursive watcher failures for the linked pnpm Profile on macOS.
    CHOKIDAR_USEPOLLING: '1',
  }
}
