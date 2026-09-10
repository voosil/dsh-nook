import { useEffect, useId, useRef, useState } from 'react'
import { Cloud, RefreshCw, X } from 'lucide-react'
import { SyncGuidePage } from './sync-guide.js'
import type { SyncStatus } from '@nook-dsh/capability-sync'
import { parseSyncConnection, CONNECTION_FILE_LIMIT } from '@nook-dsh/capability-sync'
import type { SyncApi } from '../lib/sync-api.js'

export function SyncControl({
  api,
  onChanged,
  onDeploy,
}: {
  api: SyncApi
  onChanged: (change: number) => void
  onDeploy: () => Promise<void>
}) {
  const [tab, setTab] = useState<'status' | 'configuration'>('status')
  const tabId = useId()
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
    const signal = lifecycle.current?.signal
    if (!signal || signal.aborted) return
    setBusy(true)
    setError('')
    try {
      await fn()
      if (signal.aborted) return
      const next = await api('status', {}, signal)
      if (signal.aborted) return
      setStatus(next)
    } catch (e) {
      if (!signal.aborted) setError(e instanceof Error ? e.message : '操作未完成。')
    } finally {
      if (!signal.aborted) setBusy(false)
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
          setTab('status')
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
            setTab('configuration')
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
            {(error || status?.error) && (
              <p className="nook-error" role="alert">
                {error || status?.error}
              </p>
            )}
            <div className="nook-sync-tabs" role="tablist" aria-label="数据同步视图">
              {(
                [
                  { key: 'status', label: '同步信息' },
                  { key: 'configuration', label: '配置' },
                ] as const
              ).map(item => (
                <button
                  key={item.key}
                  id={`${tabId}-${item.key}-tab`}
                  type="button"
                  role="tab"
                  aria-selected={tab === item.key}
                  aria-controls={`${tabId}-${item.key}-panel`}
                  tabIndex={tab === item.key ? 0 : -1}
                  onClick={() => setTab(item.key)}
                  onKeyDown={event => {
                    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
                    event.preventDefault()
                    const next =
                      event.key === 'Home'
                        ? 'status'
                        : event.key === 'End'
                          ? 'configuration'
                          : tab === 'status'
                            ? 'configuration'
                            : 'status'
                    setTab(next)
                    event.currentTarget.parentElement
                      ?.querySelector<HTMLButtonElement>(`[id="${tabId}-${next}-tab"]`)
                      ?.focus()
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div
              role="tabpanel"
              id={`${tabId}-configuration-panel`}
              aria-labelledby={`${tabId}-configuration-tab`}
              hidden={tab !== 'configuration'}
            >
              <p className="nook-sync-manual-guide">
                <a className="nook-sync-guide-entry" href="#nook-sync-guide">
                  配置指南 ↗
                </a>
              </p>
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
                <p className="nook-muted">{imported ? '请核对下方地址与目标服务。' : '包含密码，请勿分享。'}</p>
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
                    setTab('status')
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
                  <div className="nook-actions">
                    <button type="submit" disabled={busy || !!connectionText.trim()}>
                      {busy ? '处理中…' : status?.enabled ? '保存配置' : '验证并开启同步'}
                    </button>
                  </div>
                </div>
              </form>
            </div>
            <div
              role="tabpanel"
              id={`${tabId}-status-panel`}
              aria-labelledby={`${tabId}-status-tab`}
              hidden={tab !== 'status'}
            >
              {!status ? (
                <p role="status">正在读取同步信息…</p>
              ) : !status.url ? (
                <div className="nook-sync-empty">
                  <button type="button" disabled={busy} onClick={() => void operation(onDeploy)}>
                    {busy ? '正在打开…' : '去配置'}
                  </button>
                </div>
              ) : (
                <>
                  <dl className="nook-sync-details">
                    <div>
                      <dt>同步目录</dt>
                      <dd>{status.url}</dd>
                    </div>
                    <div>
                      <dt>最近同步</dt>
                      <dd>{status.lastSync ? new Date(status.lastSync).toLocaleString() : '尚未同步'}</dd>
                    </div>
                    <div>
                      <dt>待传版本</dt>
                      <dd>{status.pending}</dd>
                    </div>
                    <div>
                      <dt>合并方式</dt>
                      <dd>自动合并 · 保留历史</dd>
                    </div>
                  </dl>
                  {!!status.unsupported && (
                    <p>有 {status.unsupported} 条数据的类型或格式需要新版应用，原始内容已保留。</p>
                  )}
                  <div className="nook-actions">
                    {status.enabled ? (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void operation(() => api('run', {}, lifecycle.current?.signal))}
                        >
                          <RefreshCw size={14} aria-hidden="true" /> 立即同步
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void operation(() =>
                              api(
                                'configure',
                                { enabled: false, url: status.url, username: status.username },
                                lifecycle.current?.signal,
                              ),
                            )
                          }
                        >
                          关闭同步
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void operation(async () => {
                            await api(
                              'configure',
                              { enabled: true, url: status.url, username: status.username, caCert: status.caCert },
                              lifecycle.current?.signal,
                            )
                            await api('run', {}, lifecycle.current?.signal)
                          })
                        }
                      >
                        开启同步
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  )
}
