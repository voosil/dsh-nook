import { build } from 'esbuild'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const clients = [
  { id: '@nook-dsh/ui-project', directory: 'ui-project' },
  { id: '@nook-dsh/ui-sidebar', directory: 'ui-sidebar' },
]

for (const client of clients) {
  const directory = resolve(root, 'packages', client.directory)
  await build({
    entryPoints: [resolve(directory, 'src/client/index.tsx')],
    outfile: resolve(directory, 'lib/client.js'),
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    jsx: 'automatic',
    sourcemap: true,
    external: [
      'react',
      'react/jsx-runtime',
      'react-dom',
      'react-dom/client',
      '@deepseek-ai/cordis',
      '@deepseek-ai/dsh-client-ui-slots',
      '@deepseek-ai/dsh-client-ui-primitives',
      '@deepseek-ai/dsh-client-runtime/client',
    ],
    banner: {
      js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(client.id)}, factory: (require) => { var module = { exports: {} }; var exports = module.exports;`,
    },
    footer: { js: 'return module.exports; } });' },
    logLevel: 'info',
  })
}
