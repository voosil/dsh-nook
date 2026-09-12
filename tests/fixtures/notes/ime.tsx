import { createRoot } from 'react-dom/client'
import { useState } from 'react'
import { RichEditor } from '../../../packages/ui-notes/src/client/components/rich-editor.js'

function Fixture() {
  const [markdown, setMarkdown] = useState('- [ ] （这是一个）后续文字')
  return (
    <>
      <RichEditor markdown={markdown} onChange={setMarkdown} disabled={false} />
      <output aria-label="保存内容">{markdown}</output>
    </>
  )
}

createRoot(document.getElementById('root')!).render(<Fixture />)
