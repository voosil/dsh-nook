import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { bootAndVerifyWeb } from './runtime-verify.mjs'
import { assertKnownPeerWarnings } from './peer-policy.mjs'
import {
  COMMUNITY_BROWSER_VERSION,
  DSH_VERSION,
  LOCAL_PACKAGES,
  PNPM_VERSION,
  ROOT,
  run,
  runPnpm,
  pinnedRuntimeOverrides,
} from './profile-lib.mjs'

const CORDIS_VERSION = '4.0.2'
const SCHEMASTERY_VERSION = '3.18.2'
const REACT_VERSION = '18.3.1'

function runtimeEnv(home) {
  return {
    DSH_HOME: home,
    DSH_AGENTS_HOME: resolve(home, 'agents'),
    DSH_TELEMETRY_MODE: 'DISABLED',
    CHOKIDAR_USEPOLLING: '1',
  }
}

function assertComposition(composition) {
  const rows = [
    'community-browser-runtime',
    'community-browser-playwright',
    'nook-browser-adapter',
    'nook-dsh-compat',
    'nook-project-provider',
    'nook-artifact-provider',
    'nook-project-feature',
    'nook-preview-feature',
    'nook-dsh-adapter',
    'nook-agent-feature',
    'nook-ui-project',
    'nook-ui-sidebar',
    'nook-notebook-provider',
    'nook-notes-feature',
    'nook-notes-rpc',
    'nook-ui-notes',
    'nook-intelligence-adapter',
    'nook-reflection-feature',
    'nook-video-source',
    'nook-video-editor',
    'nook-video-feature',
    'nook-knowledge-adapter',
    'nook-ui-knowledge',
  ]
  for (const row of rows) {
    if (!composition.includes(`id: ${row}`)) throw new Error(`packed Profile is missing row ${row}`)
  }
  return rows.length
}

const temporaryRoot = await mkdtemp(join(tmpdir(), 'nook-package-verify-'))
const packs = resolve(temporaryRoot, 'packs')
const home = resolve(temporaryRoot, 'dsh-home')
const profile = resolve(home, 'profiles', 'nook')
let succeeded = false

try {
  await mkdir(packs, { recursive: true })
  const localDependencies = {}

  for (const directory of LOCAL_PACKAGES) {
    const packageDirectory = resolve(ROOT, 'packages', directory)
    const manifest = JSON.parse(await readFile(resolve(packageDirectory, 'package.json'), 'utf8'))
    const { stdout } = await runPnpm(['pack', '--json', '--pack-destination', packs], {
      cwd: packageDirectory,
      capture: true,
    })
    const packed = JSON.parse(stdout)
    if (packed.name !== manifest.name || packed.version !== manifest.version) {
      throw new Error(`pnpm packed an unexpected manifest for ${manifest.name}`)
    }
    localDependencies[manifest.name] = `file:${packed.filename}`
  }

  await mkdir(profile, { recursive: true })
  await mkdir(resolve(home, 'agents'), { recursive: true })
  await writeFile(
    resolve(home, 'pnpm-workspace.yaml'),
    [
      'packages:',
      '  - profiles/*',
      '',
      'overrides:',
      ...Object.entries({ ...(await pinnedRuntimeOverrides()), ...localDependencies }).map(
        ([name, tarball]) => `  '${name}': '${tarball}'`,
      ),
      '',
      'allowBuilds:',
      "  '@deepseek-ai/dsh-subprocess-local': true",
      "  '@google/genai': true",
      '  koffi: true',
      '  node-pty: true',
      '  protobufjs: true',
      '',
    ].join('\n'),
  )
  await writeFile(resolve(home, 'cordis.patch.yml'), '[]\n')
  await writeFile(resolve(profile, 'cordis.patch.yml'), '[]\n')

  const externalDependencies = {
    '@deepseek-ai/cordis': CORDIS_VERSION,
    '@deepseek-ai/dsh': DSH_VERSION,
    '@deepseek-ai/dsh-base': DSH_VERSION,
    '@deepseek-ai/dsh-client-ui-renderer': DSH_VERSION,
    '@deepseek-ai/dsh-client-ui-conversation': DSH_VERSION,
    '@deepseek-ai/dsh-client-ui-sidebar': DSH_VERSION,
    '@deepseek-ai/dsh-client-ui-slots': DSH_VERSION,
    '@deepseek-ai/dsh-tools': DSH_VERSION,
    '@deepseek-ai/dsh-api-gateway': DSH_VERSION,
    '@deepseek-ai/dsh-client-ui-layout': DSH_VERSION,
    '@deepseek-ai/dsh-typert-protocol': DSH_VERSION,
    '@deepseek-ai/dsh-typert-registry': DSH_VERSION,
    '@deepseek-ai/dsh-llm': DSH_VERSION,
    '@deepseek-ai/dsh-agent': DSH_VERSION,
    '@deepseek-ai/dsh-system-prompt': DSH_VERSION,
    '@types/react': '18.3.31',
    '@types/react-dom': '18.3.7',
    '@deepseek-ai/dsh-web-app': DSH_VERSION,
    '@deepseek-ai/schemastery': SCHEMASTERY_VERSION,
    'dsh-browser-playwright': COMMUNITY_BROWSER_VERSION,
    react: REACT_VERSION,
    'react-dom': REACT_VERSION,
  }
  const manifest = {
    name: 'nook-clean-install-verification',
    version: '0.1.0',
    private: true,
    packageManager: `pnpm@${PNPM_VERSION}`,
    dependencies: { ...externalDependencies, ...localDependencies },
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
  await writeFile(resolve(profile, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)

  await runPnpm(['install', '--dir', profile, '--no-frozen-lockfile'], { cwd: home })
  const peerCheck = await runPnpm(['peers', 'check'], {
    cwd: profile,
    capture: true,
    allowedExitCodes: [1],
  })
  // pnpm overrides can suppress the reviewed stale peer ranges; zero warnings is valid.
  if (peerCheck.code === 1) assertKnownPeerWarnings(`${peerCheck.stdout}${peerCheck.stderr}`)

  for (const directory of LOCAL_PACKAGES) {
    const sourceManifest = JSON.parse(await readFile(resolve(ROOT, 'packages', directory, 'package.json'), 'utf8'))
    const installedManifestPath = resolve(profile, 'node_modules', ...sourceManifest.name.split('/'), 'package.json')
    const installedManifest = JSON.parse(await readFile(installedManifestPath, 'utf8'))
    if (
      installedManifest.version !== sourceManifest.version ||
      JSON.stringify(installedManifest).includes('workspace:')
    ) {
      throw new Error(`packed dependency verification failed for ${sourceManifest.name}`)
    }
  }
  for (const asset of [
    'adapter-video-platform/python/collect.py',
    'adapter-video-platform/python/nook_video/bilibili.py',
    'provider-video-editor/skills/video-to-essay/SKILL.md',
    'provider-video-editor/skills/video-to-essay/references/editorial-guide.md',
    'provider-video-editor/skills/learning-notes/SKILL.md',
  ]) {
    if (!(await readFile(resolve(profile, 'node_modules', '@nook-dsh', asset), 'utf8')).trim())
      throw new Error(`empty packed video asset: ${asset}`)
  }
  const installedApp = await realpath(resolve(profile, 'node_modules', '@nook-dsh', 'app-all'))
  if (installedApp.startsWith(`${ROOT}/`))
    throw new Error('clean Profile unexpectedly resolved app-all to a workspace link')

  const bin = resolve(profile, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
  const env = runtimeEnv(home)
  const { stdout: composition } = await run(process.execPath, [bin, '--profile', 'nook', '--dump-config'], {
    cwd: temporaryRoot,
    env,
    capture: true,
  })
  const rowCount = assertComposition(composition)
  const web = await bootAndVerifyWeb({ bin, cwd: temporaryRoot, env })
  succeeded = true
  process.stdout.write(
    `Verified ${LOCAL_PACKAGES.length} packed Nook packages, ${rowCount} Profile rows, and HTTP ${web.status} from ${web.url}.\n`,
  )
} finally {
  if (process.env.NOOK_KEEP_VERIFY_TEMP === '1') {
    process.stdout.write(`Package verification directory retained at ${temporaryRoot}.\n`)
  } else {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
  if (!succeeded) process.stderr.write('Nook clean-package verification failed.\n')
}
