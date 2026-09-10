import { build } from 'esbuild'
import { resolve } from 'node:path'
import { ROOT } from '../profile/profile-lib.mjs'

for (const [name, extension] of [
  ['main', 'js'],
  ['runtime', 'mjs'],
  ['update', 'mjs'],
  ['preload', 'cjs'],
  ['supervisor', 'mjs'],
  ['windows-shutdown', 'mjs'],
  ['payload', 'mjs'],
  ['shared-client', 'mjs'],
  ['shared-broker', 'mjs'],
  ['shared-paths', 'mjs'],
]) {
  await build({
    entryPoints: [resolve(ROOT, 'apps/desktop/src', `${name}.ts`)],
    outfile: resolve(ROOT, 'apps/desktop/dist', `${name}.${extension}`),
    bundle: true,
    platform: 'node',
    format: extension === 'cjs' ? 'cjs' : 'esm',
    target: 'node24',
    external: ['electron'],
    logLevel: 'info',
  })
}
