export const sourceLabels: Record<string, string> = {
  personal: '个人笔记',
  transcript: '视频字幕 / 转写',
  'comment-note': '评论区笔记',
  'ai-article': 'AI 整理文稿',
  'ai-summary': 'AI 总结',
}
export const date = (value: string) =>
  new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
export const fullDate = (value: string) =>
  new Date(value).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
