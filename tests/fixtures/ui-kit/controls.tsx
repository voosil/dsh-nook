import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import {
  Button,
  Input,
  Textarea,
  Select,
  Dialog,
  Menu,
  Switch,
  Toast,
  uiKitStyles,
} from '../../../packages/ui-kit/src/index.js'

function Fixture() {
  const [value, setValue] = useState('')
  const [longValue, setLongValue] = useState('')
  const [text, setText] = useState('')
  const [open, setOpen] = useState(false)
  const [checked, setChecked] = useState(false)
  const [toast, setToast] = useState(false)
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null)
  return (
    <main
      style={{
        padding: 24,
        color: 'var(--nook-color-ink)',
        background: 'var(--nook-color-bg)',
        font: '14px var(--nook-font-sans)',
      }}
    >
      <style>{uiKitStyles}</style>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Button variant="accent">主操作</Button>
        <Button>次操作</Button>
        <Button variant="ghost">导航</Button>
        <Button disabled>不可用</Button>
        <Button onClick={() => setOpen(true)}>打开弹窗</Button>
        <Button onClick={() => setToast(true)}>导出</Button>
        <Switch checked={checked} onCheckedChange={setChecked}>
          自动保存
        </Switch>
      </div>
      <p>
        <label>
          名称
          <Input value={text} onChange={event => setText(event.target.value)} />
        </label>
      </p>
      <label>
        正文
        <Textarea aria-label="正文" value={text} onChange={event => setText(event.target.value)} rows={3} />
      </label>
      <p>
        <Select
          aria-label="项目"
          value={value}
          onValueChange={setValue}
          options={[
            { value: '', label: '未分类' },
            { value: 'a', label: '阅读笔记' },
            { value: 'b', label: '不可用项目', disabled: true },
          ]}
        />
      </p>
      <p>
        <Select
          aria-label="搜索项目"
          value={longValue}
          onValueChange={setLongValue}
          options={[
            { value: '', label: '全部项目' },
            ...Array.from({ length: 12 }, (_, index) => ({
              value: String(index),
              label: `项目 ${index} · 研究和阅读中的长期记录`,
            })),
          ]}
        />
      </p>
      <Button
        onContextMenu={event => {
          event.preventDefault()
          setAnchor({ x: event.clientX, y: event.clientY })
        }}
      >
        右键目标
      </Button>
      <Button
        style={{ position: 'fixed', right: 8, bottom: 8 }}
        onContextMenu={event => {
          event.preventDefault()
          setAnchor({ x: event.clientX, y: event.clientY })
        }}
      >
        边缘目标
      </Button>
      {anchor && (
        <Menu
          anchor={anchor}
          items={[
            { label: '编辑', run: () => {} },
            { label: '删除', danger: true },
          ]}
          open
          onOpenChange={next => {
            if (!next) setAnchor(null)
          }}
        />
      )}
      <Dialog title="设置" open={open} onOpenChange={setOpen}>
        <Select
          aria-label="弹窗内项目"
          value={value}
          onValueChange={setValue}
          options={[
            { value: '', label: '未分类' },
            { value: 'a', label: '阅读笔记' },
          ]}
        />
      </Dialog>
      {toast && <Toast title="已导出" message="笔记.md" onClose={() => setToast(false)} />}
    </main>
  )
}
createRoot(document.getElementById('root')!).render(<Fixture />)
