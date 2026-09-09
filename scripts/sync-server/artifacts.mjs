import { readFile } from 'node:fs/promises'
import { deflateSync, gzipSync } from 'node:zlib'
import { createHash } from 'node:crypto'

export const serverVersion = '0.1.0'
const lf = text => text.replaceAll('\r\n', '\n')
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
export async function dockerArtifacts(replacements = {}) {
  const parts = []
  for (const name of deploymentFiles) {
    const bytes =
      replacements[name] === undefined
        ? Buffer.from(lf(await readFile(new URL(name, import.meta.url), 'utf8')))
        : Buffer.from(lf(String(replacements[name])))
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
  const archive = gzipSync(Buffer.concat(parts), { level: 9 })
  // gzip's OS byte otherwise differs on macOS and Linux, breaking the embedded
  // checksum chain. Use the Linux release runner's header on every build host.
  archive[9] = 3
  return {
    version: serverVersion,
    filename: `nook-sync-${serverVersion}.tar.gz`,
    archive,
  }
}

export const assistantVersion = '0.1.0'
export async function assistantArtifacts() {
  const sha = data => createHash('sha256').update(data).digest('hex')
  const template = lf(await readFile(new URL('./assistant.py', import.meta.url), 'utf8'))
  const image = template.match(/^IMAGE = '([^']+)'/m)?.[1]
  if (!/^ghcr\.io\/voosil\/nook-sync@sha256:[a-f0-9]{64}$/.test(image ?? ''))
    throw new Error('Assistant image must be pinned')
  const compose = lf(await readFile(new URL('./compose.yaml', import.meta.url), 'utf8')).replace(
    /image: .*/,
    `image: ${image}`,
  )
  const deployment = await dockerArtifacts({ 'compose.yaml': compose })
  const filename = `nook-sync-assistant-${assistantVersion}.tar.gz`
  const source = template
    .replaceAll('__ASSISTANT_VERSION__', assistantVersion)
    .replaceAll('__DEPLOYMENT_SHA256__', sha(deployment.archive))
  const base = `https://github.com/voosil/dsh-nook/releases/download/sync-assistant-v${assistantVersion}`
  const bootstrap = `#!/bin/bash
set -euo pipefail
if [ "$(id -u)" -ne 0 ]; then exec sudo bash "$0" "$@"; fi
echo 'Nook 同步服务器安装助手：将安装服务及缺少的 Docker、Tailscale，已有数据保留。'
read -r -p '按回车开始，输入 q 退出：' answer </dev/tty
[ -z "$answer" ] || exit 0
. /etc/os-release
case "$ID:$VERSION_ID" in ubuntu:22.04|ubuntu:24.04|ubuntu:26.04|debian:12|debian:13) ;; *) echo '暂不支持此系统。'; exit 1;; esac
case "$(uname -m)" in x86_64|aarch64) ;; *) echo '暂不支持此架构。'; exit 1;; esac
[ -d /run/systemd/system ] || { echo '需要 systemd。'; exit 1; }
if ! command -v python3 >/dev/null || ! command -v curl >/dev/null || [ ! -s /etc/ssl/certs/ca-certificates.crt ]; then
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y python3 curl ca-certificates
fi
umask 077
nook_tmp=$(mktemp -d)
trap 'rm -rf "$nook_tmp"' EXIT
curl --proto '=https' --tlsv1.2 -fLsS --retry 3 '${base}/assistant.py' -o "$nook_tmp/assistant.py"
printf '%s  %s\\n' '${sha(source)}' "$nook_tmp/assistant.py" | sha256sum -c -
python3 "$nook_tmp/assistant.py" install --yes </dev/tty
`
  // The app pins the entry script, which pins Python source, which pins the deployment archive and image.
  const entry = `set -eu; . /etc/os-release; case "$ID:$VERSION_ID" in ubuntu:22.04|ubuntu:24.04|ubuntu:26.04|debian:12|debian:13) ;; *) echo "暂不支持此系统"; exit 1;; esac; echo "Nook 安装助手：自动准备下载工具"; if ! command -v curl >/dev/null || [ ! -s /etc/ssl/certs/ca-certificates.crt ]; then apt-get update && apt-get install -y curl ca-certificates; fi; nook_tmp=$(mktemp -d); trap 'rm -rf "$nook_tmp"' EXIT; curl --proto "=https" --tlsv1.2 -fLsS --retry 3 "${base}/install.sh" -o "$nook_tmp/install.sh"; printf "%s  %s\\n" "${sha(bootstrap)}" "$nook_tmp/install.sh" | sha256sum -c -; bash "$nook_tmp/install.sh"`
  const command =
    `bash -c 'if [ "$(id -u)" -ne 0 ]; then exec sudo bash "$@"; fi; exec bash "$@"' nook -c '` +
    entry.replaceAll("'", "'\\''") +
    "'"

  return { filename, archive: deployment.archive, source, bootstrap, command, version: assistantVersion }
}

/** Self-contained, shell-safe command; no mutable download endpoint or runtime fetch. */
export async function installerArtifacts() {
  const source = lf(await readFile(new URL('./setup.py', import.meta.url), 'utf8'))
  const payload = deflateSync(Buffer.from(source), { level: 9 }).toString('base64')
  const command = `sudo python3 -c 'import base64,zlib;__NOOK_INSTALLER_SOURCE__=zlib.decompress(base64.b64decode("${payload}")).decode();exec(compile(__NOOK_INSTALLER_SOURCE__,"nook-sync-setup.py","exec"))'`
  return { source, command }
}
