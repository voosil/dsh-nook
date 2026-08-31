import { readdir, readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { LOCAL_PACKAGES, ROOT } from './profile-lib.mjs'

async function filesBelow(directory) {
  const result = []
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) result.push(...(await filesBelow(path)))
    else result.push(path)
  }
  return result
}

function assertPinned(name, version, manifestName) {
  if (name.startsWith('@nook-dsh/') && version === 'workspace:*') return
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error(`${manifestName} does not pin ${name}: ${version}`)
  }
}

const manifests = [resolve(ROOT, 'package.json')]
for (const directory of LOCAL_PACKAGES) manifests.push(resolve(ROOT, 'packages', directory, 'package.json'))
for (const file of manifests) {
  const manifest = JSON.parse(await readFile(file, 'utf8'))
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    for (const [name, version] of Object.entries(manifest[field] ?? {})) {
      assertPinned(name, version, manifest.name)
    }
  }
}

for (const directory of ['capability-project', 'capability-browser', 'capability-artifact']) {
  for (const file of await filesBelow(resolve(ROOT, 'packages', directory, 'src'))) {
    const source = await readFile(file, 'utf8')
    if (/from\s+['"](?:node:|@deepseek-ai\/|dsh-browser-playwright)/.test(source)) {
      throw new Error(`Capability implementation dependency found in ${file}`)
    }
  }
}

for (const directory of ['feature-project', 'feature-agent', 'feature-preview']) {
  for (const file of await filesBelow(resolve(ROOT, 'packages', directory, 'src'))) {
    const source = await readFile(file, 'utf8')
    if (/from\s+['"](?:@nook-dsh\/provider-|dsh-browser-playwright)/.test(source)) {
      throw new Error(`Feature depends on a concrete Provider in ${file}`)
    }
  }
}

for (const directory of LOCAL_PACKAGES) {
  for (const file of await filesBelow(resolve(ROOT, 'packages', directory, 'src'))) {
    const source = await readFile(file, 'utf8')
    if (/from\s+['"][^'"]+(?:\/src\/|\/internal(?:\/|['"]))/i.test(source)) {
      throw new Error(`private package import found in ${file}`)
    }
  }
}

process.stdout.write(
  `Verified package boundaries and exact dependency specs across ${LOCAL_PACKAGES.length} Nook packages.\n`,
)
