import { Button } from '@nook-dsh/ui-kit'
import type { UpdateController } from '../hooks/use-update.js'
export function UpdatePanel({ controller }: { controller: UpdateController }) {
  const { status, error, busy, run } = controller
  const working = busy || ['checking', 'preparing', 'switching'].includes(status?.phase ?? '')
  return (
    <section className="nook-update-panel" aria-label="应用更新">
      <h2>应用更新</h2>
      <p className="nook-muted">更新此设备的 Nook。重启会中止正在进行的生成、导入和同步任务。</p>
      <p>
        当前版本：<code>{status?.current.slice(0, 12) || '源码版本'}</code>
      </p>
      {status?.target && status.target !== status.current && (
        <p>
          可用版本：<code>{status.target.slice(0, 12)}</code> {status.summary}
        </p>
      )}
      <p role="status" aria-live="polite">
        {status?.message ?? '正在连接更新服务…'}
      </p>
      {error && <p role="alert">{error}</p>}
      <div className="nook-update-actions">
        <Button disabled={!status || status.phase === 'unavailable' || working} onClick={() => void run('check')}>
          检查更新
        </Button>
        {status?.target && status.target !== status.current && (
          <Button variant="accent" disabled={working} onClick={() => void run('start')}>
            更新并重启
          </Button>
        )}
      </div>
    </section>
  )
}
