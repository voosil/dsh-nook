import { ArrowUpRight, ListChecks, Video } from 'lucide-react'
import { Button, Dialog } from '@nook-dsh/ui-kit'

export function ToolMarket({
  open,
  onOpenChange,
  onVideo,
  onSummary,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onVideo: () => void
  onSummary: () => void
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="工具市集"
      description="把素材变成记录，让思考慢慢成形。"
      className="nook-tool-market"
      closeLabel="关闭工具市集"
    >
      <div className="nook-tool-grid">
        <Button variant="ghost" className="nook-tool-card" aria-label="视频转文稿" onClick={onVideo}>
          <Video size={24} aria-hidden="true" />
          <strong>视频转文稿</strong>
          <span>从视频中整理观点，留下值得回看的文字。</span>
          <span className="nook-tool-action">
            打开工具 <ArrowUpRight size={16} aria-hidden="true" />
          </span>
        </Button>
        <Button variant="ghost" className="nook-tool-card" aria-label="日 / 周总结" onClick={onSummary}>
          <ListChecks size={24} aria-hidden="true" />
          <strong>日 / 周总结</strong>
          <span>回顾一段时间的笔记，串起收获与下一步。</span>
          <span className="nook-tool-action">
            打开工具 <ArrowUpRight size={16} aria-hidden="true" />
          </span>
        </Button>
      </div>
    </Dialog>
  )
}
