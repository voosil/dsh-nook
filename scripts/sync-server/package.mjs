import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { dockerArtifacts, serverVersion } from './artifacts.mjs'

const root = fileURLToPath(new URL('../../', import.meta.url))
const output = resolve(root, '.pack/sync-server')
await mkdir(output, { recursive: true })
const artifact = await dockerArtifacts()
await writeFile(resolve(output, artifact.filename), artifact.archive)
const files = [artifact.filename]
async function run(args, capture = false) {
  return new Promise((accept, reject) => {
    const child = spawn('docker', args, { cwd: root, stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit' })
    let data = ''
    if (capture)
      child.stdout.on('data', chunk => {
        data += chunk
      })
    child.on('error', reject)
    child.on('exit', code => (code === 0 ? accept(data) : reject(new Error(`Docker exited with ${code}`))))
  })
}
if (process.argv.includes('--image')) {
  const tag = `nook-sync:${serverVersion}`
  await run(['build', '-t', tag, 'scripts/sync-server'])
  const [metadata] = JSON.parse(await run(['image', 'inspect', tag], true))
  const filename = `nook-sync-${serverVersion}-${metadata.Os}-${metadata.Architecture}.tar`
  await run(['image', 'save', '-o', resolve(output, filename), tag])
  const receipt = `${filename}.json`
  await writeFile(
    resolve(output, receipt),
    JSON.stringify({ tag, id: metadata.Id, os: metadata.Os, architecture: metadata.Architecture }, null, 2) + '\n',
  )
  files.push(filename, receipt)
}
const sums = []
for (const name of files) {
  const hash = createHash('sha256')
  for await (const bytes of createReadStream(resolve(output, name))) hash.update(bytes)
  sums.push(`${hash.digest('hex')}  ${name}`)
}
await writeFile(resolve(output, 'SHA256SUMS'), sums.join('\n') + '\n')
console.log(`Sync deployment artifacts: ${output}`)
