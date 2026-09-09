import { useEffect, useRef, useState } from 'react'
import { Cloud, RefreshCw, X } from 'lucide-react'
import { SyncGuidePage } from './sync-guide.js'
import type { SyncStatus, SyncConflict, Json } from '@nook-dsh/capability-sync'
import { parseSyncConnection, CONNECTION_FILE_LIMIT } from '@nook-dsh/capability-sync'
import type { SyncRemote, Method, Request, Value, Result } from '@nook-dsh/adapter-sync-dsh/rpc'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
export type SyncApi = <K extends Method>(method: K, request: Request<K>, signal?: AbortSignal) => Promise<Value<K>>
export function syncApi(remote: SyncRemote): SyncApi {
  return async <K extends Method>(method: K, request: Request<K>, signal?: AbortSignal): Promise<Value<K>> => {
    const call = remote[method] as (r: Request<K>, s?: AbortSignal) => Promise<RemoteResult<Result<Value<K>>>>
    const response = await call(request, signal)
    if (!response.ok) throw new Error(response.error.message)
    if (!response.value.ok) throw new Error(response.value.error.message)
    return response.value.value
  }
}
function preview(data: Json) {
  if (data && typeof data === 'object' && !Array.isArray(data) && 'markdown' in data) return String(data.markdown)
  return JSON.stringify(data, null, 2)
}
export function SyncControl({ api, onChanged }: { api: SyncApi; onChanged: (change: number) => void }) {
  const [guideOpen, setGuideOpen] = useState(window.location.hash === '#nook-sync-guide')
  useEffect(() => {
    const changed = () => setGuideOpen(window.location.hash === '#nook-sync-guide')
    window.addEventListener('hashchange', changed)
    return () => window.removeEventListener('hashchange', changed)
  }, [])
  const [caCert, setCaCert] = useState('')
  const [imported, setImported] = useState(false)
  const importInput = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [open, setOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const [url, setUrl] = useState(''),
    [username, setUsername] = useState(''),
    [password, setPassword] = useState('')
  const [conflicts, setConflicts] = useState<readonly SyncConflict[]>([])
  const change = useRef<number | undefined>(undefined),
    changed = useRef(onChanged)
  changed.current = onChanged
  const lifecycle = useRef<AbortController | null>(null)
  useEffect(() => {
    const controller = new AbortController()
    lifecycle.current = controller
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try {
        const next = await api('status', {}, controller.signal)
        if (controller.signal.aborted) return
        setStatus(next)
        if (change.current !== next.change) {
          change.current = next.change
          changed.current(next.change)
        }
      } catch {
        /* next poll reconnects; form operations surface errors */
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(() => void poll(), 3000)
      }
    }
    void poll()
    return () => {
      controller.abort()
      clearTimeout(timer)
      lifecycle.current = null
    }
  }, [api])
  async function operation(fn: () => Promise<unknown>) {
    setBusy(true)
    setError('')
    try {
      await fn()
      if (lifecycle.current?.signal.aborted) return
      setStatus(await api('status', {}, lifecycle.current?.signal))
      setConflicts(await api('conflicts', {}, lifecycle.current?.signal))
    } catch (e) {
      if (!lifecycle.current?.signal.aborted) setError(e instanceof Error ? e.message : '操作未完成。')
    } finally {
      setBusy(false)
    }
  }
  const label = !status?.enabled
    ? '同步未开启'
    : status.state === 'syncing'
      ? '正在同步'
      : status.error
        ? '同步失败'
        : status.unsupported
          ? '有数据需要升级'
          : status.conflicts
            ? '有同步冲突'
            : status.pending
              ? '等待同步'
              : status.lastSync
                ? '已同步'
                : '等待首次同步'
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setUrl(status?.url ?? '')
          setUsername(status?.username ?? '')
          setPassword('')
          setImported(false)
          setCaCert(status?.caCert ?? '')
          setOpen(true)
          void operation(async () => {})
        }}
      >
        <Cloud size={16} aria-hidden="true" /> 数据同步 <small>{label}</small>
      </button>
      {guideOpen && (
        <SyncGuidePage
          onBack={() => {
            if (!open) {
              setUrl(status?.url ?? '')
              setUsername(status?.username ?? '')
              setCaCert(status?.caCert ?? '')
            }
            window.location.hash = 'nook'
            setOpen(true)
          }}
        />
      )}
      {open && !guideOpen && (
        <div
          className="nook-modal-backdrop"
          onKeyDown={event => {
            if (event.key === 'Escape') {
              event.stopPropagation()
              if (!busy) setOpen(false)
            }
          }}
        >
          <section className="nook-modal nook-sync-modal" role="dialog" aria-modal="true" aria-label="数据同步">
            <div className="nook-heading">
              <h2>数据同步</h2>
              <button type="button" aria-label="关闭同步设置" disabled={busy} onClick={() => setOpen(false)}>
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <p>连接自己的 WebDAV 存储，在多台设备间同步笔记和项目。每台设备都保留本地数据。</p>
            <a className="nook-sync-guide-entry" href="#nook-sync-guide">
              查看服务器 / NAS 配置指南 ↗
            </a>
            <p role="status">
              {label}
              {status?.enabled && ` · ${status.pending} 个待传版本 · ${status.conflicts} 条冲突`}
            </p>
            {status?.lastSync && <small>最近完成：{new Date(status.lastSync).toLocaleString()}</small>}
            {(error || status?.error) && (
              <p className="nook-error" role="alert">
                {error || status?.error}
              </p>
            )}
            {!!status?.unsupported && <p>有 {status.unsupported} 条数据的类型或格式需要新版应用，原始内容已保留。</p>}
            <div className="nook-sync-import">
              <button type="button" disabled={busy} onClick={() => importInput.current?.click()}>
                导入连接配置
              </button>
              <input
                ref={importInput}
                hidden
                type="file"
                accept=".json,application/json"
                aria-label="连接配置文件"
                disabled={busy}
                onChange={event => {
                  const file = event.target.files?.[0]
                  event.target.value = ''
                  if (!file) return
                  const signal = lifecycle.current?.signal
                  setBusy(true)
                  setError('')
                  void (async () => {
                    try {
                      if (file.size > CONNECTION_FILE_LIMIT) throw new Error('连接文件不能超过 32 KB。')
                      const config = parseSyncConnection(await file.text())
                      if (!signal || signal.aborted) return
                      setUrl(config.url)
                      setUsername(config.username)
                      setPassword(config.password)
                      setCaCert(config.caCert)
                      setImported(true)
                    } catch (error) {
                      if (signal && !signal.aborted)
                        setError(error instanceof Error ? error.message : '无法读取连接文件。')
                    } finally {
                      if (signal && !signal.aborted) setBusy(false)
                    }
                  })()
                }}
              />
              <p className="nook-muted">
                {imported
                  ? '连接信息已填入。请核对下方服务器地址，点击“验证并开启同步”完成连接。'
                  : '选择服务器导出的 connection.json，一次填入地址、凭据和 CA 证书。文件含密码，请妥善保管。'}
              </p>
            </div>
            <form
              onSubmit={event => {
                event.preventDefault()
                void operation(async () => {
                  await api(
                    'configure',
                    { enabled: true, url, username, caCert, ...(password ? { password } : {}) },
                    lifecycle.current?.signal,
                  )
                  setPassword('')
                  setImported(false)
                  await api('run', {}, lifecycle.current?.signal)
                })
              }}
            >
              <label>
                WebDAV 同步目录
                <input
                  required
                  type="url"
                  placeholder="https://example.com/dav/nook/"
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                  disabled={busy}
                />
              </label>
              <label>
                存储用户名
                <input
                  autoComplete="off"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  disabled={busy}
                />
              </label>
              <label>
                存储密码或应用令牌
                <input
                  type="password"
                  autoComplete="new-password"
                  placeholder={status?.hasPassword ? '留空保留已保存的凭据' : ''}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  disabled={busy}
                />
              </label>
              <label>
                服务器 CA 证书（可选）
                <textarea
                  rows={3}
                  placeholder="内网 / IP 部署：粘贴工具输出的完整 CA 证书；公开可信证书留空"
                  value={caCert}
                  onChange={e => setCaCert(e.target.value)}
                  disabled={busy}
                />
              </label>
              <p className="nook-muted">
                首次开启会先备份并校验本地数据，然后合并远端内容。请选择专供 Nook
                使用的目录。独立文件、对话和模型配置不在同步范围内。
              </p>
              <div className="nook-actions">
                <button type="submit" disabled={busy}>
                  验证并开启同步
                </button>
                <button
                  type="button"
                  disabled={busy || !status?.enabled}
                  onClick={() => void operation(() => api('run', {}, lifecycle.current?.signal))}
                >
                  <RefreshCw size={14} aria-hidden="true" /> 立即同步
                </button>
                <button
                  type="button"
                  disabled={busy || !status?.enabled}
                  onClick={() =>
                    void operation(() => api('configure', { enabled: false, url, username }, lifecycle.current?.signal))
                  }
                >
                  关闭同步
                </button>
              </div>
            </form>
            {!!conflicts.length && (
              <div className="nook-sync-conflicts">
                <h3>选择需要保留的版本</h3>
                <p>被替换的内容会先备份。保留全部会把其他版本另存为副本。</p>
                {conflicts.map(c => (
                  <article key={c.key}>
                    <h4>
                      {c.type === 'note' ? '笔记' : c.type === 'project' ? '项目' : c.type} · {c.id}
                    </h4>
                    {c.versions.map(v => (
                      <div key={v.hash}>
                        <small>
                          {v.value.deleted ? '已删除版本' : '内容版本'} · {v.hash.slice(0, 10)}
                        </small>
                        <textarea readOnly rows={5} aria-label="冲突版本内容" value={preview(v.value.data)} />
                        <div className="nook-actions">
                          <button
                            disabled={busy}
                            onClick={() =>
                              void operation(() =>
                                api(
                                  'resolve',
                                  { key: c.key, expected: c.versions.map(x => x.hash), selected: v.hash, copy: false },
                                  lifecycle.current?.signal,
                                ),
                              )
                            }
                          >
                            保留此版本
                          </button>
                          {['note', 'project'].includes(c.type) && (
                            <button
                              disabled={busy}
                              onClick={() =>
                                void operation(() =>
                                  api(
                                    'resolve',
                                    { key: c.key, expected: c.versions.map(x => x.hash), selected: v.hash, copy: true },
                                    lifecycle.current?.signal,
                                  ),
                                )
                              }
                            >
                              保留此版本及其他副本
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </article>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </>
  )
}
