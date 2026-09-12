import { readdir, access } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { resolve, relative, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { ProcessScope } from '../shared/process-scope.mjs'
import { ROOT, PNPM_VERSION } from '../profile/profile-lib.mjs'

const groups = {
  unit: ['unit'],
  component: ['component'],
  integration: ['integration'],
  e2e: ['e2e'],
  profile: ['e2e/profile'],
  package: ['e2e/distribution/package', 'e2e/distribution/update'],
  desktop: ['e2e/distribution/desktop'],
  windows: ['e2e/distribution/windows'],
  'sync-server': ['e2e/sync-server/docker'],
  'sync-assistant': ['integration/sync-server/docker'],
  'sync-linux': ['integration/sync-server/linux'],
}
const ordinary = new Set(['unit', 'component', 'integration', 'e2e'])
const testFile = name => /\.test\.(?:ts|tsx|mjs|js)$/.test(name) || /^test_.*\.py$/.test(name)

/** Discover suite directories rather than maintaining a list of test files. */
export async function discoverTests(group, { root = resolve(ROOT, 'tests'), platform = process.platform } = {}) {
  if (!groups[group]) throw new Error(`Unknown test group: ${group}`)
  const files = [],
    skipped = []
  async function visit(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name)
      if (entry.isDirectory()) {
        if (['helpers', 'fixtures', 'node_modules', '__pycache__'].includes(entry.name)) continue
        if (ordinary.has(group) && ['distribution', 'docker', 'linux'].includes(entry.name)) continue
        if (entry.name === 'posix' && platform === 'win32') {
          skipped.push(file)
          continue
        }
        await visit(file)
      } else if (entry.isFile() && testFile(entry.name)) files.push(file)
    }
  }
  for (const directory of groups[group]) await visit(resolve(root, directory))
  return { files: files.sort(), skipped }
}

function pythonExecutable(env) {
  const candidates = env.NOOK_TEST_PYTHON ? [env.NOOK_TEST_PYTHON] : ['python3', 'python', 'py']
  for (const command of candidates) {
    const result = spawnSync(command, ['-c', 'import sys; print(sys.executable)'], {
      env,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 10_000,
    })
    if (result.status === 0 && result.stdout.trim()) return result.stdout.trim()
  }
  throw new Error('Python is required by this test group; install it or set NOOK_TEST_PYTHON to its executable.')
}

export async function runGroups(names, options = {}) {
  const {
    root = resolve(ROOT, 'tests'),
    prepared = false,
    skipPackage = false,
    list = false,
    match,
    env = process.env,
  } = options
  const selected = [...new Set(names.flatMap(name => (name === 'all' ? ['unit', 'component', 'integration'] : [name])))]
  const suites = []
  for (const name of selected) {
    const suite = await discoverTests(name, { root })
    if (match) suite.files = suite.files.filter(file => relative(root, file).replaceAll('\\', '/').includes(match))
    if (!suite.files.length) throw new Error(`No tests selected for ${name}; refusing an empty success.`)
    suites.push({ name, ...suite })
  }
  if (list) {
    for (const suite of suites)
      console.log(
        JSON.stringify({ ...suite, files: suite.files.map(file => relative(root, file).replaceAll('\\', '/')) }),
      )
    return
  }
  if (selected.includes('desktop') && (process.platform !== 'darwin' || process.arch !== 'arm64'))
    throw new Error('Desktop acceptance requires macOS arm64.')
  if (selected.includes('windows') && process.platform !== 'win32')
    throw new Error('Windows startup acceptance requires Windows.')
  if (selected.includes('sync-linux') && process.platform !== 'linux')
    throw new Error('Linux dependency acceptance requires a disposable Linux container.')
  if (selected.includes('sync-assistant') && process.platform === 'win32')
    throw new Error('Sync assistant acceptance requires a POSIX host with Node and Docker.')
  const childEnv = { ...env }
  // A runner invoked by another Node test must create its own test harness.
  delete childEnv.NODE_TEST_CONTEXT
  if (suites.some(s => s.files.some(f => f.endsWith('.py')))) {
    childEnv.NOOK_TEST_PYTHON = pythonExecutable(childEnv)
    childEnv.PYTHONUTF8 = '1'
  }
  const scope = new ProcessScope()
  let interrupted = false
  let cleanup
  const dispose = () => (cleanup ??= scope.dispose())
  const stop = () => {
    interrupted = true
    void dispose().catch(error => console.error(error.message))
  }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  const run = async (command, args, extra = {}) => {
    if (interrupted) throw new Error('Test run interrupted')
    return scope.run(command, args, { cwd: ROOT, env: childEnv, windowsHide: true, ...extra })
  }
  const pnpm = args => run('corepack', [`pnpm@${PNPM_VERSION}`, ...args])
  try {
    if (selected.some(name => ['sync-server', 'sync-assistant'].includes(name)))
      await run('docker', ['info'], { capture: true })
    if (selected.includes('sync-linux')) {
      await access('/.dockerenv')
      try {
        await access('/var/run/docker.sock')
        throw new Error('Linux dependency acceptance must not use a host Docker socket.')
      } catch (error) {
        if (error.code !== 'ENOENT') throw error
      }
    }
    if (!prepared) {
      if (selected.includes('sync-server')) {
        const { serverVersion } = await import('../sync-server/artifacts.mjs')
        await run('docker', ['build', '-t', `nook-sync:${serverVersion}`, join(ROOT, 'scripts/sync-server')])
      }
      if (selected.includes('desktop') && !skipPackage) await pnpm(['run', 'desktop:package'])
      else if (selected.some(name => name !== 'desktop' && !name.startsWith('sync-'))) await pnpm(['run', 'build'])
      if (selected.some(name => ['integration', 'e2e', 'profile'].includes(name))) await pnpm(['run', 'dev:profile'])
    }
    const seen = new Set()
    for (const suite of suites) {
      for (const directory of suite.skipped)
        console.log(`Platform not applicable (${process.platform}): ${relative(root, directory)}`)
      const files = suite.files.filter(file => !seen.has(file))
      for (const file of files) seen.add(file)
      console.log(`Test group ${suite.name}: ${files.length} files`)
      const nodeFiles = files.filter(file => !file.endsWith('.py'))
      if (nodeFiles.length)
        await run(process.execPath, ['--import', 'tsx', '--test', '--test-concurrency=1', ...nodeFiles])
      const pythonFiles = files.filter(file => file.endsWith('.py'))
      if (pythonFiles.length)
        await run(childEnv.NOOK_TEST_PYTHON, [join(ROOT, 'scripts/test/python.py'), ...pythonFiles])
    }
  } finally {
    try {
      await dispose()
    } finally {
      process.off('SIGINT', stop)
      process.off('SIGTERM', stop)
    }
  }
}

export async function main(args = process.argv.slice(2)) {
  const names = [],
    options = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--') continue
    if (arg === '--prepared') options.prepared = true
    else if (arg === '--skip-package') options.skipPackage = true
    else if (arg === '--list') options.list = true
    else if (arg === '--tests-root' || arg === '--match') {
      if (!args[i + 1] || args[i + 1].startsWith('--')) throw new Error(`Missing value for ${arg}`)
      options[arg === '--tests-root' ? 'root' : 'match'] = args[++i]
    } else if (arg.startsWith('--')) throw new Error(`Unknown test option: ${arg}`)
    else names.push(arg)
  }
  await runGroups(names.length ? names : ['all'], options)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    console.error(error.message)
    process.exitCode = 1
  })
}
