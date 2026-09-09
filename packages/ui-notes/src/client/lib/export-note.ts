import { noteTitle, type NoteInput } from '@nook-dsh/capability-note'

export interface ExportReceipt {
  id?: string
  name: string
}
declare global {
  interface Window {
    nookDesktop?: {
      exportNote(request: { name: string; markdown: string }): Promise<{ id: string; name: string }>
      revealExport(id: string): Promise<void>
    }
  }
}

export async function exportNote(input: Pick<NoteInput, 'title' | 'markdown'>): Promise<ExportReceipt> {
  const name = `${noteTitle(input)
    .replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, '_')
    .slice(0, 60)}.md`
  const markdown = input.title ? `# ${input.title}\n\n${input.markdown}` : input.markdown
  if (window.nookDesktop) return window.nookDesktop.exportNote({ name, markdown })
  const url = URL.createObjectURL(new Blob([markdown], { type: 'text/markdown;charset=utf-8' }))
  try {
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = name
    anchor.click()
  } finally {
    URL.revokeObjectURL(url)
  }
  return { name }
}
