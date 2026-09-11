import { randomUUID, X509Certificate } from 'node:crypto'
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https'
import { Agent as HttpAgent, request as httpRequest } from 'node:http'
import { Context, Service } from '@deepseek-ai/cordis'
import { SyncError, type StorageConfig, type SyncStorage, type SyncStorageFactory } from '@nook-dsh/capability-sync'

declare module '@deepseek-ai/cordis' {
  interface Context {
    nookSyncStorage: SyncStorageFactory
  }
}
const equal = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((v, i) => v === b[i])
export function normalizeTarget(input: string): string {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new SyncError('请输入完整的 WebDAV HTTPS 地址。')
  }
  if (
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new SyncError('同步地址必须使用 HTTPS（本机测试除外），凭据请填写在独立字段。')
  url.pathname = url.pathname.replace(/\/+$/, '') + '/'
  return url.href
}
export class WebDavStorage implements SyncStorage {
  private readonly root: URL
  private readonly agent: HttpAgent
  private readonly lifecycle = new AbortController()
  constructor(private readonly config: StorageConfig) {
    this.root = new URL(normalizeTarget(config.url))
    if (config.caCert) {
      try {
        if (typeof config.caCert !== 'string' || config.caCert.length > 16000 || this.root.protocol !== 'https:')
          throw new Error()
        const cert = new X509Certificate(config.caCert)
        if (
          !cert.ca ||
          /PRIVATE KEY/.test(config.caCert) ||
          !/^-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----\s*$/.test(config.caCert)
        )
          throw new Error()
      } catch {
        throw new SyncError('服务器 CA 证书无效，请粘贴部署工具输出的完整证书，不要粘贴私钥。')
      }
    }
    const Agent = this.root.protocol === 'https:' ? HttpsAgent : HttpAgent
    this.agent = new Agent({ keepAlive: true, maxSockets: 6, maxFreeSockets: 6 })
  }
  dispose() {
    this.lifecycle.abort(new SyncError('同步连接已关闭。'))
    this.agent.destroy()
  }
  private async request(
    path: string,
    method: string,
    signal: AbortSignal,
    bytes?: Uint8Array,
    condition?: string | null,
  ) {
    signal = AbortSignal.any([signal, this.lifecycle.signal])
    signal.throwIfAborted()
    if (!/^(?:[a-z0-9.-]+\/)*[a-zA-Z0-9.-]*$/.test(path) || path.split('/').some(p => p === '.' || p === '..'))
      throw new SyncError('无效的同步对象路径。')
    const controller = new AbortController()
    const abort = () => controller.abort(signal.reason)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    const timer = setTimeout(() => controller.abort(), 30000)
    try {
      const headers: Record<string, string> = { 'Cache-Control': 'no-cache' }
      if (this.config.username || this.config.password)
        headers.Authorization = `Basic ${Buffer.from(`${this.config.username}:${this.config.password}`).toString('base64')}`
      if (condition !== undefined) headers[condition === null ? 'If-None-Match' : 'If-Match'] = condition ?? '*'
      if (bytes) headers['Content-Type'] = 'application/octet-stream'
      const url = new URL(path, this.root)
      return await new Promise<{ status: number; bytes: Buffer; etag: string }>((resolve, reject) => {
        const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
          url,
          {
            method,
            headers,
            signal: controller.signal,
            agent: this.agent,
            // A private CA is scoped to this connection; normal hostname and expiry checks remain enabled.
            ...(this.config.caCert ? { ca: this.config.caCert } : {}),
          },
          response => {
            const chunks: Buffer[] = []
            let size = 0
            const max = path.startsWith('blobs/')
              ? 20_000_000
              : path.endsWith('.epoch')
                ? 32_000_000
                : /\.(pack|history)$/.test(path)
                  ? 8_000_000
                  : 4_000_000
            response.on('data', (chunk: Buffer) => {
              size += chunk.length
              if (size > max) {
                request.destroy(new SyncError('远端对象超出大小限制。'))
                return
              }
              chunks.push(chunk)
            })
            response.on('error', reject)
            response.on('end', () =>
              resolve({
                status: response.statusCode ?? 0,
                bytes: Buffer.concat(chunks),
                etag: response.headers.etag ?? '',
              }),
            )
          },
        )
        request.on('error', reject)
        request.end(bytes ? Buffer.from(bytes) : undefined)
      })
    } catch (error) {
      if (error instanceof SyncError) throw error
      if (signal.aborted) throw signal.reason ?? new SyncError('同步已停止。')
      throw new SyncError('连接 WebDAV 失败或超时，请检查地址、网络与证书。')
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
    }
  }
  async get(path: string, signal: AbortSignal) {
    signal = AbortSignal.any([signal, this.lifecycle.signal])
    for (let attempt = 0; ; attempt++) {
      const r = await this.request(path, 'GET', signal)
      if (r.status === 404) return null
      if (r.status !== 200) this.fail(r.status)
      // Some servers emit a weak tag until the filesystem timestamp settles.
      // Re-read the representation; never strip W/ or use a weak tag for writes.
      if ((path === 'index.json' || path.startsWith('probes/')) && r.etag.startsWith('W/') && attempt < 3) {
        await new Promise<void>((resolve, reject) => {
          const cleanup = () => {
            clearTimeout(timer)
            signal.removeEventListener('abort', abort)
          }
          const abort = () => {
            cleanup()
            reject(signal.reason)
          }
          const timer = setTimeout(() => {
            cleanup()
            resolve()
          }, 1100)
          signal.addEventListener('abort', abort, { once: true })
          if (signal.aborted) abort()
        })
        continue
      }
      return { bytes: r.bytes, etag: r.etag }
    }
  }
  async put(path: string, bytes: Uint8Array, expected: string | null, signal: AbortSignal) {
    if (expected !== null && !/^"[^\r\n]+"$/.test(expected)) throw new SyncError('WebDAV 未提供强 ETag，不能安全同步。')
    const r = await this.request(path, 'PUT', signal, bytes, expected)
    if (r.status === 412) return false
    if (![200, 201, 204].includes(r.status)) this.fail(r.status)
    return true
  }
  private fail(status: number): never {
    throw new SyncError(
      status === 401 || status === 403
        ? 'WebDAV 拒绝访问，请检查存储凭据和目录权限。'
        : `WebDAV 请求未完成（HTTP ${status}）。`,
    )
  }
  async probe(signal: AbortSignal) {
    for (const dir of ['', 'objects/', 'blobs/', 'probes/']) {
      const r = await this.request(dir, 'MKCOL', signal)
      if (![201, 405].includes(r.status)) this.fail(r.status)
    }
    const path = `probes/${randomUUID()}`
    const first = Buffer.from('nook-a'),
      next = Buffer.from('nook-b')
    try {
      const created = await Promise.all([this.put(path, first, null, signal), this.put(path, first, null, signal)])
      if (created.filter(Boolean).length !== 1) throw new SyncError('WebDAV 不支持原子条件创建。')
      const a = await this.get(path, signal)
      if (!a || !equal(a.bytes, first) || !/^"[^\r\n]+"$/.test(a.etag))
        throw new SyncError('WebDAV 不支持所需的字节完整性或强 ETag。')
      const updated = await Promise.all([
        this.put(path, next, a.etag, signal),
        this.put(path, Buffer.from('nook-c'), a.etag, signal),
      ])
      if (updated.filter(Boolean).length !== 1) throw new SyncError('WebDAV 不支持原子条件更新。')
      const b = await this.get(path, signal)
      if (
        !b ||
        b.etag === a.etag ||
        !equal(b.bytes, updated[0] ? next : Buffer.from('nook-c')) ||
        (await this.put(path, first, a.etag, signal))
      )
        throw new SyncError('WebDAV 的并发写入或读写一致性验证失败。')
    } finally {
      if (!signal.aborted) await this.request(path, 'DELETE', signal).catch(() => {})
    }
  }
}
export default class WebDavFactory extends Service implements SyncStorageFactory {
  constructor(ctx: Context) {
    super(ctx, 'nookSyncStorage')
  }
  open(config: StorageConfig): SyncStorage {
    return new WebDavStorage(config)
  }
}
