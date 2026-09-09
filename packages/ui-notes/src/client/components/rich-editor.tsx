import { Bold, Code, Heading2, Italic, List, ListChecks, Quote, Redo2, Undo2 } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Button } from './button.js'

export function RichEditor({
  markdown,
  onChange,
  disabled,
}: {
  markdown: string
  onChange: (markdown: string) => void
  disabled: boolean
}) {
  const changed = useRef(onChange)
  changed.current = onChange
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false }, underline: false }),
      Markdown,
      TaskList,
      TaskItem.configure({ nested: true }),
    ],
    content: markdown,
    contentType: 'markdown',
    editable: !disabled,
    immediatelyRender: false,
    editorProps: { attributes: { 'aria-label': '笔记正文', role: 'textbox', 'aria-multiline': 'true' } },
    onUpdate: ({ editor: current }) => changed.current(current.getMarkdown()),
  })
  useEffect(() => {
    editor?.setEditable(!disabled, false)
  }, [editor, disabled])
  return (
    <>
      {!disabled && (
        <div className="nook-toolbar" role="toolbar" aria-label="正文格式">
          <Button
            title="标题"
            onClick={() => {
              editor?.chain().focus().toggleHeading({ level: 2 }).run()
            }}
          >
            <Heading2 size={16} aria-hidden="true" />
          </Button>
          <Button
            title="粗体"
            onClick={() => {
              editor?.chain().focus().toggleBold().run()
            }}
          >
            <Bold size={16} aria-hidden="true" />
          </Button>
          <Button
            title="斜体"
            onClick={() => {
              editor?.chain().focus().toggleItalic().run()
            }}
          >
            <Italic size={16} aria-hidden="true" />
          </Button>
          <Button
            title="无序列表"
            onClick={() => {
              editor?.chain().focus().toggleBulletList().run()
            }}
          >
            <List size={16} aria-hidden="true" /> 列表
          </Button>
          <Button
            title="待办清单"
            onClick={() => {
              editor?.chain().focus().toggleTaskList().run()
            }}
          >
            <ListChecks size={16} aria-hidden="true" /> 待办
          </Button>
          <Button
            title="引用"
            onClick={() => {
              editor?.chain().focus().toggleBlockquote().run()
            }}
          >
            <Quote size={16} aria-hidden="true" /> 引用
          </Button>
          <Button
            title="代码块"
            onClick={() => {
              editor?.chain().focus().toggleCodeBlock().run()
            }}
          >
            <Code size={16} aria-hidden="true" />
          </Button>
          <Button
            title="撤销"
            onClick={() => {
              editor?.chain().focus().undo().run()
            }}
          >
            <Undo2 size={16} aria-hidden="true" />
          </Button>
          <Button
            title="重做"
            onClick={() => {
              editor?.chain().focus().redo().run()
            }}
          >
            <Redo2 size={16} aria-hidden="true" />
          </Button>
        </div>
      )}
      <EditorContent editor={editor} />
    </>
  )
}
