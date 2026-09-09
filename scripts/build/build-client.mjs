import { build } from 'esbuild'
import { resolve } from 'node:path'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { installerArtifacts, dockerArtifacts, assistantArtifacts } from '../sync-server/artifacts.mjs'

const root = resolve(import.meta.dirname, '../..')
const clients = [
  { id: '@nook-dsh/ui-knowledge', directory: 'ui-knowledge' },
  { id: '@nook-dsh/ui-notes', directory: 'ui-notes' },
  { id: '@nook-dsh/ui-project', directory: 'ui-project' },
  { id: '@nook-dsh/ui-sidebar', directory: 'ui-sidebar' },
]

const installer = await installerArtifacts()
const docker = await dockerArtifacts()
const assistant = await assistantArtifacts()
const output = []
for (const client of clients) {
  const directory = resolve(root, 'packages', client.directory)
  const result = await build({
    write: false,
    define: {
      __NOOK_SYNC_SETUP_SOURCE__: JSON.stringify(installer.source),
      __NOOK_SYNC_ASSISTANT_COMMAND__: JSON.stringify(assistant.command),
      __NOOK_SYNC_SETUP_COMMAND__: JSON.stringify(installer.command),
      __NOOK_SYNC_DOCKER_ARCHIVE__: JSON.stringify(docker.archive.toString('base64')),
      __NOOK_SYNC_DOCKER_FILENAME__: JSON.stringify(docker.filename),
    },
    entryPoints: [resolve(directory, 'src/client/index.tsx')],
    outfile: resolve(directory, 'lib/client.js'),
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    loader: { '.css': 'text' },
    sourcemap: true,
    external: [
      'react',
      'react/jsx-runtime',
      'react-dom',
      'react-dom/client',
      '@deepseek-ai/cordis',
      '@deepseek-ai/dsh-client-ui-slots',
      '@deepseek-ai/dsh-client-ui-primitives',
      '@deepseek-ai/dsh-client-ui-renderer/client',
    ],
    banner: {
      js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(client.id)}, factory: (require) => { var module = { exports: {} }; var exports = module.exports;`,
    },
    footer: { js: 'return module.exports; } });' },
    logLevel: 'info',
  })
  output.push(...result.outputFiles)
}

// Failed bundles publish nothing. Atomic replacements keep the HMR poll from
// reading half-written JavaScript during successful builds.
for (const file of output) {
  await mkdir(resolve(file.path, '..'), { recursive: true })
  const temporary = `${file.path}.${process.pid}.tmp`
  await writeFile(temporary, file.contents)
  await rename(temporary, file.path)
}
