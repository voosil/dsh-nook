import assert from 'node:assert/strict'
import { test } from 'node:test'
import { getSchema } from '@tiptap/core'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { MarkdownManager } from '@tiptap/markdown'
import { closeHistory, history, redo, undo } from '@tiptap/pm/history'
import type { Node } from '@tiptap/pm/model'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import StarterKit from '@tiptap/starter-kit'
import { deleteEmptyMiddleListItem } from '../../packages/ui-notes/src/client/lib/delete-empty-list-item.ts'

const extensions = [StarterKit, TaskList, TaskItem.configure({ nested: true })]
const schema = getSchema(extensions)
const markdown = new MarkdownManager({ extensions })
const paragraph = (text = '') => schema.nodes.paragraph.create(null, text ? schema.text(text) : undefined)
const item = (text = '', extra: Node[] = []) => schema.nodes.listItem.create(null, [paragraph(text), ...extra])

function select(doc: Node, text: string, offset = 0) {
  let pos = -1
  doc.descendants((node, start) => {
    if (pos === -1 && node.type.name === 'paragraph' && node.textContent === text) pos = start + 1 + offset
  })
  assert.ok(pos >= 0)
  return TextSelection.create(doc, pos)
}

function stateFor(list: Node) {
  const doc = schema.nodes.doc.create(null, list)
  return EditorState.create({ doc, selection: select(doc, ''), plugins: [history()] })
}

for (const listName of ['orderedList', 'bulletList', 'taskList']) {
  test(`${listName}: removes the empty middle item, preserves siblings and selects the next item`, () => {
    const itemType = schema.nodes[listName === 'taskList' ? 'taskItem' : 'listItem']
    const nested = schema.nodes.bulletList.create(null, [item('nested')])
    const last = itemType.create(listName === 'taskList' ? { checked: true } : null, [
      schema.nodes.paragraph.create(null, schema.text('ccc', [schema.marks.bold.create()])),
      nested,
    ])
    const list = schema.nodes[listName].create(listName === 'orderedList' ? { start: 5 } : null, [
      itemType.create(null, paragraph('aaa')),
      itemType.create(null, paragraph()),
      last,
    ])
    let state = stateFor(list)
    const initial = state
    assert.equal(deleteEmptyMiddleListItem(state), true)
    assert.equal(state.doc, initial.doc)
    assert.equal(
      deleteEmptyMiddleListItem(state, tr => (state = state.apply(tr))),
      true,
    )
    state.doc.check()
    const result = state.doc.firstChild!
    assert.equal(result.childCount, 2)
    assert.ok(result.child(0).eq(list.child(0)))
    assert.ok(result.child(1).eq(last))
    assert.deepEqual(result.attrs, list.attrs)
    assert.equal(state.selection.$from.parent.textContent, 'ccc')
    assert.equal(state.selection.$from.parentOffset, 0)
    if (listName === 'orderedList') assert.match(markdown.serialize(state.doc.toJSON()), /^5\. aaa\n6\. \*\*ccc\*\*/)
    const deleted = state.doc
    assert.equal(
      undo(state, tr => (state = state.apply(tr))),
      true,
    )
    assert.ok(state.doc.eq(initial.doc))
    assert.ok(state.selection.eq(initial.selection))
    assert.equal(
      redo(state, tr => (state = state.apply(tr))),
      true,
    )
    assert.ok(state.doc.eq(deleted))
  })
}

test('nested list: only removes the empty item at the caret depth', () => {
  const nested = schema.nodes.orderedList.create(null, [item('aaa'), item(), item('ccc')])
  let state = stateFor(schema.nodes.bulletList.create(null, [item('parent', [nested]), item('sibling')]))
  deleteEmptyMiddleListItem(state, tr => (state = state.apply(tr)))
  state.doc.check()
  assert.equal(markdown.serialize(state.doc.toJSON()), '- parent\n  1. aaa\n  2. ccc\n- sibling')
})

for (const [name, children] of [
  ['first item', [item(), item('bbb'), item('ccc')]],
  ['last item', [item('aaa'), item('bbb'), item()]],
  ['only item', [item()]],
  [
    'item with a nested list',
    [item('aaa'), item('', [schema.nodes.bulletList.create(null, [item('nested')])]), item('ccc')],
  ],
  ['item with another paragraph', [item('aaa'), item('', [paragraph('keep me')]), item('ccc')]],
] as const) {
  test(`${name}: falls through without discarding content or changing list-exit behavior`, () => {
    const state = stateFor(schema.nodes.orderedList.create(null, children))
    assert.equal(
      deleteEmptyMiddleListItem(state, () => assert.fail('must not dispatch')),
      false,
    )
  })
}

test('text, whitespace, selections and standalone empty paragraphs retain normal deletion', () => {
  for (const text of ['bbb', ' ']) {
    const doc = schema.nodes.doc.create(
      null,
      schema.nodes.orderedList.create(null, [item('aaa'), item(text), item('ccc')]),
    )
    const state = EditorState.create({ doc, selection: select(doc, text) })
    assert.equal(deleteEmptyMiddleListItem(state), false)
  }
  let state = stateFor(schema.nodes.orderedList.create(null, [item('aaa'), item(), item('ccc')]))
  state = state.apply(
    state.tr.setSelection(TextSelection.create(state.doc, state.selection.from, select(state.doc, 'ccc').from + 1)),
  )
  assert.equal(deleteEmptyMiddleListItem(state), false)
  assert.equal(
    deleteEmptyMiddleListItem(EditorState.create({ doc: schema.nodes.doc.create(null, paragraph()) })),
    false,
  )
})

test('undo restores the empty item separately from clearing its text', () => {
  const doc = schema.nodes.doc.create(
    null,
    schema.nodes.orderedList.create(null, [item('aaa'), item('bbb'), item('ccc')]),
  )
  let state = EditorState.create({ doc, selection: select(doc, 'bbb'), plugins: [history()] })
  state = state.apply(closeHistory(state.tr).delete(state.selection.from, state.selection.from + 3))
  deleteEmptyMiddleListItem(state, tr => (state = state.apply(tr)))
  undo(state, tr => (state = state.apply(tr)))
  assert.equal(markdown.serialize(state.doc.toJSON()), '1. aaa\n2. \n3. ccc')
  undo(state, tr => (state = state.apply(tr)))
  assert.ok(state.doc.eq(doc))
})
