import { readdir, readFile } from 'node:fs/promises'
import { resolve, dirname, sep } from 'node:path'
import ts from 'typescript'
import { ROOT } from '../profile/profile-lib.mjs'

// Dependency boundaries are repository contracts, not a copy of Profile membership.
const packages = (await readdir(resolve(ROOT, 'packages'), { withFileTypes: true }))
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)
if (!packages.length) throw new Error('No packages found; refusing an empty boundary verification')

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
for (const directory of packages) manifests.push(resolve(ROOT, 'packages', directory, 'package.json'))
for (const file of manifests) {
  const manifest = JSON.parse(await readFile(file, 'utf8'))
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
    for (const [name, version] of Object.entries(manifest[field] ?? {})) {
      assertPinned(name, version, manifest.name)
    }
  }
}

for (const directory of packages.filter(name => name.startsWith('capability-'))) {
  for (const file of await filesBelow(resolve(ROOT, 'packages', directory, 'src'))) {
    const source = await readFile(file, 'utf8')
    if (/from\s+['"](?:node:|@deepseek-ai\/|dsh-browser-playwright)/.test(source)) {
      throw new Error(`Capability implementation dependency found in ${file}`)
    }
  }
}

for (const directory of packages.filter(name => name.startsWith('feature-'))) {
  for (const file of await filesBelow(resolve(ROOT, 'packages', directory, 'src'))) {
    const source = await readFile(file, 'utf8')
    if (/from\s+['"](?:@nook-dsh\/provider-|dsh-browser-playwright)/.test(source)) {
      throw new Error(`Feature depends on a concrete Provider in ${file}`)
    }
  }
}

for (const directory of packages) {
  for (const file of await filesBelow(resolve(ROOT, 'packages', directory, 'src'))) {
    const source = await readFile(file, 'utf8')
    if (/from\s+['"][^'"]+(?:\/src\/|\/internal(?:\/|['"]))/i.test(source)) {
      throw new Error(`private package import found in ${file}`)
    }
  }
}

// These are engineering ownership rules; they do not replace behavioral tests.
for (const area of ['tests', 'scripts/verify']) {
  for (const file of await filesBelow(resolve(ROOT, area))) {
    if (!/\.(?:ts|tsx|js|mjs)$/.test(file)) continue
    const source = ts.createSourceFile(file, await readFile(file, 'utf8'), ts.ScriptTarget.Latest, true)
    const imports = []
    function visit(node) {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        imports.push(node.moduleSpecifier.text)
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword || node.expression.getText(source) === 'require') &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      )
        imports.push(node.arguments[0].text)
      ts.forEachChild(node, visit)
    }
    visit(source)
    const forbidden = resolve(ROOT, area === 'tests' ? 'scripts/verify' : 'tests') + sep
    for (const specifier of imports) {
      if (specifier.startsWith('.') && resolve(dirname(file), specifier).startsWith(forbidden)) {
        throw new Error(
          `Tests and verify must meet through the test runner, not a direct import: ${file} -> ${specifier}`,
        )
      }
    }
  }
}

process.stdout.write(
  `Verified package boundaries and exact dependency specs across ${packages.length} Nook packages.\n`,
)
