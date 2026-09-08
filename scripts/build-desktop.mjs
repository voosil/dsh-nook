import { build } from 'esbuild'
import { resolve } from 'node:path'
import { ROOT } from './profile-lib.mjs'

for (const [name, extension] of [
  ['main', 'js'],
  ['supervisor', 'mjs'],
  ['payload', 'mjs'],
]) {
  await build({
    entryPoints: [resolve(ROOT, 'apps/desktop/src', `${name}.ts`)],
    outfile: resolve(ROOT, 'apps/desktop/dist', `${name}.${extension}`),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node24',
    external: ['electron'],
    logLevel: 'info',
  })
}
