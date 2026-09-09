import { FolderOpen, X } from 'lucide-react'
import type { ExportReceipt } from '../lib/export-note.js'

export function ExportToast({
  receipt,
  close,
  onError,
}: {
  receipt: ExportReceipt
  close: () => void
  onError: (message: string) => void
}) {
  return (
    <div className="nook-export-toast" role="status">
      <div>
        <strong>{receipt.id ? '笔记已导出' : '已开始下载笔记'}</strong>
        <p>{receipt.name}</p>
        {receipt.id ? (
          <button
            onClick={() => {
              void window.nookDesktop?.revealExport(receipt.id!).catch(cause => onError(String(cause)))
            }}
          >
            <FolderOpen size={16} aria-hidden="true" /> 打开文件夹
          </button>
        ) : (
          <small>可在浏览器下载列表中查看文件。</small>
        )}
      </div>
      <button aria-label="关闭导出提示" onClick={close}>
        <X size={16} aria-hidden="true" />
      </button>
    </div>
  )
}
