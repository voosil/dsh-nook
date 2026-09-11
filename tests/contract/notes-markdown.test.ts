import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getSchema } from '@tiptap/core'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { MarkdownManager } from '@tiptap/markdown'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import {
  createFillEmptyBlocksPlugin,
  fixEmptyBlocks,
} from '../../packages/ui-notes/src/client/lib/fill-empty-blocks.ts'

const extensions = [
  StarterKit.configure({ link: { openOnClick: false }, underline: false }),
  TaskList,
  TaskItem.configure({ nested: true }),
]
const manager = new MarkdownManager({ extensions })
const schema = getSchema(extensions)

function parseCorrupted(markdown: string) {
  // @tiptap/markdown 3.31.3 的 orderedList tokenizer + parseListItems 会把
  // 空列表项（如 `1. xxx\n2. `）解析成没有 paragraph 子节点的 listItem，
  // 这里断言该损坏形状存在，保证测试针对的是真实缺陷。
  const json = manager.parse(markdown)
  assert.ok(JSON.stringify(json).includes('"listItem","content":[]'))
  return json
}

test('markdown round-trip keeps trailing empty ordered list item editable', () => {
  const corrupted = parseCorrupted('1. xxx\n2. ')

  const fixed = fixEmptyBlocks(schema.nodeFromJSON(corrupted))
  assert.ok(fixed)
  assert.doesNotThrow(() => fixed.check())

  const list = fixed.content.firstChild
  assert.equal(list?.type.name, 'orderedList')
  const secondItem = list?.content.child(1)
  assert.equal(secondItem?.type.name, 'listItem')
  assert.equal(secondItem?.childCount, 1)
  assert.equal(secondItem?.child(0).type.name, 'paragraph')
  assert.equal(secondItem?.child(0).childCount, 0)

  // 修复后的文档重新序列化仍是原文，往返不再漂移
  assert.equal(manager.serialize(fixed.toJSON()), '1. xxx\n2. ')
})

test('fixEmptyBlocks leaves schema-valid documents untouched', () => {
  const valid = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: '段落' }] },
      {
        type: 'bulletList',
        content: [
          { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }] }] },
          { type: 'listItem', content: [{ type: 'paragraph', content: [] }] },
        ],
      },
      {
        type: 'taskList',
        content: [{ type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [] }] }],
      },
      { type: 'blockquote', content: [{ type: 'paragraph', content: [] }] },
      { type: 'heading', attrs: { level: 2 }, content: [] },
    ],
  }
  const doc = schema.nodeFromJSON(valid)
  assert.doesNotThrow(() => doc.check())
  assert.equal(fixEmptyBlocks(doc), null)
})

test('plugin fixes any transaction that leaves an empty required container, keeping the caret editable', () => {
  const corrupted = parseCorrupted('1. xxx\n2. ')
  const state = EditorState.create({
    doc: schema.nodeFromJSON(corrupted),
    plugins: [createFillEmptyBlocksPlugin()],
  })

  const edit = state.tr.insertText('A', 4)
  const afterEdit = state.apply(edit)
  assert.doesNotThrow(() => afterEdit.doc.check())
  const list = afterEdit.doc.content.firstChild
  assert.equal(list?.content.child(1)?.childCount, 1)

  // 修复其他列表项时，保留编辑事务的光标位置。
  assert.deepEqual(afterEdit.selection.toJSON(), edit.selection.toJSON())

  // 在原本无法定位的「2.」项里输入文字
  let emptyItemParagraphStart = -1
  afterEdit.doc.descendants((node, pos) => {
    if (node.type.name === 'listItem' && node.childCount > 0 && node.lastChild?.childCount === 0) {
      emptyItemParagraphStart = pos + 1 + 1
    }
  })
  assert.ok(emptyItemParagraphStart > 0)
  const afterType = afterEdit.apply(afterEdit.tr.insertText('好', emptyItemParagraphStart))
  assert.doesNotThrow(() => afterType.doc.check())
  assert.equal(manager.serialize(afterType.doc.toJSON()), '1. xAxx\n2. 好')
})

for (const selection of ['caret before', 'backward range before', 'caret after'] as const) {
  test(`markdown refresh preserves ${selection} multiple empty list items`, () => {
    const initial = fixEmptyBlocks(schema.nodeFromJSON(parseCorrupted('1. xxx\n2. \n3. \n\nafter')))
    assert.ok(initial)
    const state = EditorState.create({ doc: initial, plugins: [createFillEmptyBlocksPlugin()] })
    const refreshed = schema.nodeFromJSON(parseCorrupted('1. xxx\n2. \n3. \n\nafter updated'))
    // RichEditor 在 setContent 后恢复选区；追加的修复事务必须继续保留它。
    const refresh = state.tr
      .setMeta('addToHistory', false)
      .setMeta('preventUpdate', true)
      .replaceWith(0, state.doc.content.size, refreshed.content)
    const anchor = selection === 'caret after' ? refreshed.content.size - 3 : selection === 'caret before' ? 4 : 6
    const head = selection === 'backward range before' ? 4 : anchor
    refresh.setSelection(TextSelection.create(refresh.doc, anchor, head))

    const result = state.applyTransaction(refresh)
    const after = result.state
    assert.doesNotThrow(() => after.doc.check())
    assert.equal(result.transactions.length, 2)
    assert.equal(after.selection.$anchor.parentOffset, refresh.selection.$anchor.parentOffset)
    assert.equal(after.selection.$head.parentOffset, refresh.selection.$head.parentOffset)
    assert.equal(after.selection.$anchor.parent.textContent, refresh.selection.$anchor.parent.textContent)
    assert.equal(after.selection.$head.parent.textContent, refresh.selection.$head.parent.textContent)

    const typed = after.apply(after.tr.insertText('A'))
    assert.equal(
      manager.serialize(typed.doc.toJSON()),
      selection === 'caret after'
        ? '1. xxx\n2. \n3. \n\nafter updatAed'
        : selection === 'caret before'
          ? '1. xAxx\n2. \n3. \n\nafter updated'
          : '1. xA\n2. \n3. \n\nafter updated',
    )
  })
}

test('plugin does not alter transactions on already-valid documents', () => {
  const valid = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'hello' }] },
      {
        type: 'bulletList',
        content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [] }] }],
      },
    ],
  }
  const state = EditorState.create({
    doc: schema.nodeFromJSON(valid),
    plugins: [createFillEmptyBlocksPlugin()],
  })

  const afterEdit = state.apply(state.tr.insertText('!', 6))
  assert.equal(fixEmptyBlocks(afterEdit.doc), null)
  assert.equal(afterEdit.doc.content.firstChild?.textContent, 'hello!')
})
