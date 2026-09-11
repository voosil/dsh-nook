import type { ReactNode } from 'react'
import { Cloud, Palette, Check, RefreshCw } from 'lucide-react'
import { Button, Dialog } from '@nook-dsh/ui-kit'
import type { Appearance } from '../hooks/use-appearance.js'

export function SettingsDialog({
  open,
  onOpenChange,
  section,
  onSectionChange,
  appearance,
  onAppearanceChange,
  children,
  update,
  syncDisabled = false,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  section: 'appearance' | 'sync' | 'update'
  onSectionChange: (section: 'appearance' | 'sync' | 'update') => void
  appearance: Appearance
  onAppearanceChange: (appearance: Appearance) => void
  children: ReactNode
  update?: ReactNode
  syncDisabled?: boolean
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="设置" closeLabel="关闭设置" className="nook-settings">
      <div className="nook-settings-layout">
        <nav className="nook-settings-nav" aria-label="设置分类">
          <Button
            variant="ghost"
            active={section === 'appearance'}
            aria-current={section === 'appearance' ? 'page' : undefined}
            onClick={() => onSectionChange('appearance')}
          >
            <Palette size={18} aria-hidden="true" />
            外观
          </Button>
          <Button
            variant="ghost"
            active={section === 'sync'}
            disabled={syncDisabled}
            aria-label="数据同步"
            title={syncDisabled ? '开发环境已禁用数据同步' : '数据同步'}
            aria-current={section === 'sync' ? 'page' : undefined}
            onClick={() => onSectionChange('sync')}
          >
            <Cloud size={18} aria-hidden="true" />
            数据同步
          </Button>
          <Button
            variant="ghost"
            active={section === 'update'}
            aria-current={section === 'update' ? 'page' : undefined}
            onClick={() => onSectionChange('update')}
          >
            <RefreshCw size={18} aria-hidden="true" />
            应用更新
          </Button>
        </nav>
        <div className="nook-settings-content">
          {section === 'appearance' ? (
            <section className="nook-appearance" aria-labelledby="nook-appearance-title">
              <h2 id="nook-appearance-title">外观</h2>
              <p className="nook-muted">让记录的空间，也合你的心意。</p>
              <h3>主题</h3>
              <div className="nook-theme-options" role="group" aria-label="主题">
                {(
                  [
                    ['paper', 'Nook 纸感', '自然绿意，轻盈日常'],
                    ['claude', 'Claude 暖纸', '暖米白与陶土色，安静阅读'],
                    ['night', '夜晚', '柔和炭灰，留一盏暖光'],
                    ['memphis', '孟菲斯', '浅蓝嫩黄浅粉，青春亮丽'],
                  ] as const
                ).map(([value, name, detail]) => (
                  <Button
                    key={value}
                    variant="ghost"
                    className="nook-theme-option"
                    aria-pressed={appearance === value}
                    onClick={() => onAppearanceChange(value)}
                  >
                    <span className="nook-theme-preview" data-nook-theme={value} aria-hidden="true">
                      <span className="nook-theme-preview-nav">
                        <i />
                        <i />
                        <i />
                      </span>
                      <span className="nook-theme-preview-page">
                        <b>Aa</b>
                        <i />
                        <i />
                        <em />
                      </span>
                    </span>
                    <span className="nook-theme-label">
                      {name}
                      {appearance === value && <Check size={16} aria-hidden="true" />}
                    </span>
                    <span className="nook-muted">{detail}</span>
                  </Button>
                ))}
              </div>
              <p className="nook-muted nook-theme-hint">立即生效，保存在当前设备。</p>
            </section>
          ) : section === 'update' ? (
            update
          ) : syncDisabled ? (
            <p className="nook-muted">开发环境已禁用数据同步</p>
          ) : (
            children
          )}
        </div>
      </div>
    </Dialog>
  )
}
