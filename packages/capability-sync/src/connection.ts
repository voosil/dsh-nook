/** Portable connection file. Parsing never connects, persists credentials, or enables sync. */
export const CONNECTION_FILE_LIMIT = 32_768
export interface SyncConnection {
  readonly format: 'nook-sync-connection'
  readonly version: 1
  readonly url: string
  readonly username: string
  readonly password: string
  readonly caCert: string
}
export function parseSyncConnection(source: string): SyncConnection {
  const invalid = () => new Error('连接文件无效。请选择部署工具导出的 connection.json。')
  if (new TextEncoder().encode(source).byteLength > CONNECTION_FILE_LIMIT) throw invalid()
  let value: unknown
  try {
    value = JSON.parse(source.replace(/^\uFEFF/, ''))
  } catch {
    throw invalid()
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid()
  const data = value as Record<string, unknown>
  // Accept the exact legacy installer export, but reject partially versioned/foreign files.
  const legacy = !('format' in data) && !('version' in data)
  if (!legacy && (data.format !== 'nook-sync-connection' || data.version !== 1))
    throw new Error('不支持此连接文件版本，请使用匹配版本的 Nook 和部署工具。')
  if (Object.keys(data).some(key => !['format', 'version', 'url', 'username', 'password', 'caCert'].includes(key)))
    throw invalid()
  for (const [key, max] of [
    ['url', 2000],
    ['username', 500],
    ['password', 2000],
    ['caCert', 16000],
  ] as const) {
    if (typeof data[key] !== 'string' || data[key].length > max) throw invalid()
  }
  const { url, username, password, caCert } = data as unknown as SyncConnection
  if (!username || !password || /[:\r\n\0]/.test(username) || /[\r\n\0]/.test(password)) throw invalid()
  let target: URL
  try {
    target = new URL(url)
  } catch {
    throw invalid()
  }
  if (
    (target.protocol !== 'https:' &&
      !(target.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(target.hostname))) ||
    target.username ||
    target.password ||
    target.search ||
    target.hash
  )
    throw invalid()
  if (
    caCert &&
    (target.protocol !== 'https:' ||
      /PRIVATE KEY/.test(caCert) ||
      !/^-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----\s*$/.test(caCert))
  )
    throw invalid()
  return { format: 'nook-sync-connection', version: 1, url, username, password, caCert }
}
