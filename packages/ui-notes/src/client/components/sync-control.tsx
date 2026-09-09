import { useEffect, useRef, useState } from 'react'
import { Cloud, RefreshCw, X } from 'lucide-react'
import { SyncGuidePage } from './sync-guide.js'
import type { SyncStatus, SyncConflict, Json } from '@nook-dsh/capability-sync'
import { parseSyncConnection, CONNECTION_FILE_LIMIT } from '@nook-dsh/capability-sync'
import type { SyncApi } from '../lib/sync-api.js'

function preview(data: Json) {
  if (data && typeof data === 'object' && !Array.isArray(data) && 'markdown' in data) return String(data.markdown)
  return JSON.stringify(data, null, 2)
}
export function SyncControl({
  api,
  onChanged,
  onDeploy,
}: {
  api: SyncApi
  onChanged: (change: number) => void
  onDeploy: () => Promise<void>
}) {
  const [guideOpen, setGuideOpen] = useState(window.location.hash === '#nook-sync-guide')
  useEffect(() => {
    const changed = () => setGuideOpen(window.location.hash === '#nook-sync-guide')
    window.addEventListener('hashchange', changed)
    return () => window.removeEventListener('hashchange', changed)
  }, [])
  const [caCert, setCaCert] = useState('')
  const [imported, setImported] = useState(false)
  const [connectionText, setConnectionText] = useState('')
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
  function importConnection(source: string) {
    const config = parseSyncConnection(source)
    setUrl(config.url)
    setUsername(config.username)
    setPassword(config.password)
    setCaCert(config.caCert)
    setImported(true)
    setConnectionText('')
    setError('')
  }
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
          setConnectionText('')
          setCaCert(status?.caCert ?? '')
          setOpen(true)
          void operation(async () => {})
        }}
      >
        <Cloud size={16} aria-hidden="true" /> 数据同步 <small>{label}</small>
      </button>
      {guideOpen && (
        <SyncGuidePage
          onDeploy={onDeploy}
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
              <div className="nook-sync-title">
                <h2>数据同步</h2>
                <span className="nook-sync-status" role="status">
                  {label}
                </span>
              </div>
              <button type="button" aria-label="关闭同步设置" disabled={busy} onClick={() => setOpen(false)}>
                <X size={18} aria-hidden="true" />
              </button>
            </div>
            <p className="nook-sync-description nook-muted">通过 WebDAV 在设备间同步笔记和项目。</p>
            {status?.enabled && (
              <p className="nook-sync-progress nook-muted" role="status">
                {status.pending > 0 && <span>{status.pending} 个待传版本</span>}
                {status.conflicts > 0 && <span>{status.conflicts} 条冲突</span>}
                {status.lastSync && <span>最近同步：{new Date(status.lastSync).toLocaleString()}</span>}
              </p>
            )}
            {(error || status?.error) && (
              <p className="nook-error" role="alert">
                {error || status?.error}
              </p>
            )}
            {!!status?.unsupported && <p>有 {status.unsupported} 条数据的类型或格式需要新版应用，原始内容已保留。</p>}
            <div className="nook-sync-import">
              <div className="nook-sync-import-heading">
                <span>{imported ? '连接信息已导入' : '连接信息'}</span>
                <button type="button" disabled={busy} onClick={() => importInput.current?.click()}>
                  导入连接配置
                </button>
              </div>
              {!imported && (
                <textarea
                  aria-label="粘贴连接信息"
                  rows={2}
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={CONNECTION_FILE_LIMIT}
                  placeholder="粘贴安装助手提供的连接信息"
                  value={connectionText}
                  disabled={busy}
                  onChange={event => {
                    const text = event.target.value
                    setConnectionText(text)
                    setError('')
                    if (!text.trim()) return
                    try {
                      importConnection(text)
                    } catch (error) {
                      setError(error instanceof Error ? error.message : '无法识别连接信息。')
                    }
                  }}
                />
              )}
              {imported && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setImported(false)
                    setPassword('')
                  }}
                >
                  使用其他连接信息
                </button>
              )}
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
                      const text = await file.text()
                      if (!signal || signal.aborted) return
                      importConnection(text)
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
                {imported ? '请核对下方地址。家庭服务器需连接同一 Tailscale 网络。' : '包含密码，请勿分享。'}
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
              <details key={imported ? 'imported' : 'manual'}>
                <summary>账号与证书</summary>
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
                    placeholder="粘贴 CA 证书；公开可信证书可留空"
                    value={caCert}
                    onChange={e => setCaCert(e.target.value)}
                    disabled={busy}
                  />
                </label>
              </details>
              <details className="nook-sync-info">
                <summary>同步范围与数据保护</summary>
                <p className="nook-muted">
                  仅同步笔记和项目，不含独立文件、对话及模型配置。每台设备保留本地数据，首次开启前自动备份并校验。请使用
                  Nook 专用目录。
                </p>
              </details>
              <div className="nook-sync-footer">
                <a className="nook-sync-guide-entry" href="#nook-sync-guide">
                  配置指南 ↗
                </a>
                <div className="nook-actions">
                  <button type="submit" disabled={busy || !!connectionText.trim()}>
                    {busy ? '处理中…' : status?.enabled ? '保存配置' : '验证并开启同步'}
                  </button>
                  {status?.enabled && (
                    <>
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
                          void operation(() =>
                            api('configure', { enabled: false, url, username }, lifecycle.current?.signal),
                          )
                        }
                      >
                        关闭同步
                      </button>
                    </>
                  )}
                </div>
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
