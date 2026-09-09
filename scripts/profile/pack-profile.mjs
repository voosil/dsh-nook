import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import {
  COMMUNITY_BROWSER_VERSION,
  DSH_VERSION,
  LOCAL_PACKAGES,
  PNPM_VERSION,
  ROOT,
  runPnpm as defaultRunPnpm,
  pinnedRuntimeOverrides,
} from './profile-lib.mjs'

const CORDIS_VERSION = '4.0.2'
const SCHEMASTERY_VERSION = '3.18.2'
const REACT_VERSION = '18.3.1'

/** Build an independent installation from already compiled Nook packages. */
export async function createPackedProfile(temporaryRoot, { runPnpm = defaultRunPnpm, portable = false } = {}) {
  const home = resolve(temporaryRoot, 'dsh-home')
  const packs = portable ? resolve(home, 'packs') : resolve(temporaryRoot, 'packs')
  const profile = resolve(home, 'profiles', 'nook')
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
    localDependencies[manifest.name] = portable
      ? `file:../../packs/${basename(packed.filename)}`
      : `file:${packed.filename}`
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
      ...Object.entries({
        ...(await pinnedRuntimeOverrides()),
        ...Object.fromEntries(
          Object.entries(localDependencies).map(([name, value]) => [
            name,
            portable ? value.replace('file:../../packs/', 'file:./packs/') : value,
          ]),
        ),
      }).map(([name, tarball]) => `  '${name}': '${tarball}'`),
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
  return { home, profile, bin: resolve(profile, 'node_modules/@deepseek-ai/dsh/lib/bin.js') }
}
