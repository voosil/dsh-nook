import { useEffect, useRef, useState } from 'react'
import { Cloud, RefreshCw } from 'lucide-react'
import { Button, Input, TabPanel, Tabs, Textarea } from '@nook-dsh/ui-kit'
import { SettingsDialog } from './settings-dialog.js'
import type { Appearance } from '../hooks/use-appearance.js'
import { SyncGuidePage } from './sync-guide.js'
import type { SyncStatus } from '@nook-dsh/capability-sync'
import { parseSyncConnection, CONNECTION_FILE_LIMIT } from '@nook-dsh/capability-sync'
import type { SyncApi } from '../lib/sync-api.js'

export function SyncControl({
  api,
  onChanged,
  onDeploy,
  open,
  onOpenChange,
  appearance,
  onAppearanceChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  appearance: Appearance
  onAppearanceChange: (appearance: Appearance) => void
  api: SyncApi
  onChanged: (change: number) => void
  onDeploy: () => Promise<void>
}) {
  const [tab, setTab] = useState<'status' | 'configuration'>('status')
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
  const [section, setSection] = useState<'appearance' | 'sync'>('appearance')
  const setOpen = onOpenChange
  const [busy, setBusy] = useState(false),
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
  useEffect(() => {
    if (!open) return
    setUrl(status?.url ?? '')
    setUsername(status?.username ?? '')
    setPassword('')
    setImported(false)
    setConnectionText('')
    setCaCert(status?.caCert ?? '')
    void operation(async () => {})
  }, [open])
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
      {guideOpen && (
        <SyncGuidePage
          onDeploy={onDeploy}
          onBack={() => {
            if (!open) {
              setUrl(status?.url ?? '')
              setUsername(status?.username ?? '')
              setCaCert(status?.caCert ?? '')
            }
            setSection('sync')
            setTab('configuration')
            window.location.hash = 'nook'
            setOpen(true)
          }}
        />
      )}
      {open && !guideOpen && (
        <SettingsDialog
          open
          onOpenChange={next => {
            if (!busy) setOpen(next)
          }}
          section={section}
          onSectionChange={setSection}
          appearance={appearance}
          onAppearanceChange={onAppearanceChange}
        >
          <section className="nook-sync-modal" aria-label="数据同步">
            <h2>数据同步</h2>
            <p className="nook-muted nook-sync-description">让笔记与项目在你的设备间保持一致。</p>
            <div className="nook-sync-overview">
              <span className="nook-sync-symbol">
                <Cloud size={22} aria-hidden="true" />
              </span>
              <div>
                <p className="nook-sync-status" role="status">
                  {label}
                </p>
                <p className="nook-muted">
                  {status?.enabled ? '自动同步 · 本地保留完整副本' : '数据只保存在当前设备上'}
                </p>
              </div>
            </div>
            {(error || status?.error) && (
              <p className="nook-error" role="alert">
                {error || status?.error}
              </p>
            )}
            <Tabs
              value={tab}
              onValueChange={next => setTab(next as typeof tab)}
              tabs={[
                { value: 'status', label: '同步信息' },
                { value: 'configuration', label: '配置' },
              ]}
            >
              <TabPanel value="configuration" className="nui-tab-panel">
                <div className="nook-sync-manual-guide">
                  <div>
                    <h3>连接你的同步服务</h3>
                    <p className="nook-muted">导入连接信息，或填写已有 WebDAV 目录。</p>
                  </div>
                  <a className="nook-sync-guide-entry" href="#nook-sync-guide">
                    配置指南 ↗
                  </a>
                </div>
                <div className="nook-sync-import">
                  <div className="nook-sync-import-heading">
                    <span>{imported ? '连接信息已导入' : '连接信息'}</span>
                    <Button disabled={busy} onClick={() => importInput.current?.click()}>
                      导入连接配置
                    </Button>
                  </div>
                  {!imported && (
                    <Textarea
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
                    <Button
                      disabled={busy}
                      onClick={() => {
                        setImported(false)
                        setPassword('')
                      }}
                    >
                      使用其他连接信息
                    </Button>
                  )}
                  <input
                    ref={importInput}
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
                  id="nook-sync-configuration"
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
                    <Input
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
                      <Input
                        autoComplete="off"
                        value={username}
                        onChange={e => setUsername(e.target.value)}
                        disabled={busy}
                      />
                    </label>
                    <label>
                      存储密码或应用令牌
                      <Input
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
                      <Textarea
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
                </form>
              </TabPanel>
              <TabPanel value="status" className="nui-tab-panel">
                {!status ? (
                  <p role="status">正在读取同步信息…</p>
                ) : !status.url ? (
                  <div className="nook-sync-empty">
                    <span className="nook-sync-empty-icon">
                      <Cloud size={32} aria-hidden="true" />
                    </span>
                    <h3>在每台设备上，接着记录</h3>
                    <p className="nook-muted">
                      连接同步服务后，笔记和项目会自动同步。
                      <br />
                      可以让安装助手协助配置，也可以在「配置」中接入已有服务。
                    </p>
                    <Button variant="accent" disabled={busy} onClick={() => void operation(onDeploy)}>
                      {busy ? '正在打开…' : '去配置'}
                    </Button>
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
                          <Button
                            variant="accent"
                            disabled={busy}
                            onClick={() => void operation(() => api('run', {}, lifecycle.current?.signal))}
                          >
                            <RefreshCw size={14} aria-hidden="true" /> 立即同步
                          </Button>
                          <Button
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
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="accent"
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
                        </Button>
                      )}
                    </div>
                  </>
                )}
              </TabPanel>
            </Tabs>
            <div className="nook-sync-footer">
              <span className="nook-muted">仅同步笔记与项目</span>
              {tab === 'configuration' ? (
                <Button
                  form="nook-sync-configuration"
                  type="submit"
                  variant="accent"
                  disabled={busy || !!connectionText.trim()}
                >
                  {busy ? '处理中…' : status?.enabled ? '保存配置' : '验证并开启同步'}
                </Button>
              ) : (
                <Button disabled={busy} onClick={() => setOpen(false)}>
                  完成
                </Button>
              )}
            </div>
          </section>
        </SettingsDialog>
      )}
    </>
  )
}
