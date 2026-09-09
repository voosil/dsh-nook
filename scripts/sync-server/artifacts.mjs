import { readFile } from 'node:fs/promises'
import { deflateSync, gzipSync } from 'node:zlib'

export const serverVersion = '0.1.0'
export const deploymentFiles = [
  'Dockerfile',
  'compose.yaml',
  'compose.domain.yaml',
  'compose.build.yaml',
  '.env.example',
  '.dockerignore',
  'setup.py',
  'container.py',
  'DOCKER.md',
]

/** Deterministic ustar archive; only the explicit deployment allowlist is shipped. */
export async function dockerArtifacts() {
  const parts = []
  for (const name of deploymentFiles) {
    const bytes = await readFile(new URL(name, import.meta.url))
    const header = Buffer.alloc(512)
    header.write(name)
    const octal = (value, offset, width) => header.write(value.toString(8).padStart(width - 1, '0') + '\0', offset)
    octal(0o644, 100, 8)
    octal(0, 108, 8)
    octal(0, 116, 8)
    octal(bytes.length, 124, 12)
    octal(0, 136, 12)
    header.fill(32, 148, 156)
    header.write('0', 156)
    header.write('ustar\0', 257)
    header.write('00', 263)
    const checksum = header.reduce((total, byte) => total + byte, 0)
    header.write(checksum.toString(8).padStart(6, '0') + '\0 ', 148)
    parts.push(header, bytes, Buffer.alloc((512 - (bytes.length % 512)) % 512))
  }
  parts.push(Buffer.alloc(1024))
  return {
    version: serverVersion,
    filename: `nook-sync-${serverVersion}.tar.gz`,
    archive: gzipSync(Buffer.concat(parts), { level: 9 }),
  }
}

/** Self-contained, shell-safe command; no mutable download endpoint or runtime fetch. */
export async function installerArtifacts() {
  const source = await readFile(new URL('./setup.py', import.meta.url), 'utf8')
  const payload = deflateSync(Buffer.from(source), { level: 9 }).toString('base64')
  const command = `sudo python3 -c 'import base64,zlib;__NOOK_INSTALLER_SOURCE__=zlib.decompress(base64.b64decode("${payload}")).decode();exec(compile(__NOOK_INSTALLER_SOURCE__,"nook-sync-setup.py","exec"))'`
  return { source, command }
}
