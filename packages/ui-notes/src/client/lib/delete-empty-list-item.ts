import { Extension } from '@tiptap/core'
import { closeHistory } from '@tiptap/pm/history'
import { TextSelection } from '@tiptap/pm/state'
import type { Command } from '@tiptap/pm/state'

/** Remove only a wholly empty middle item; boundary items keep the usual list-exit behavior. */
export const deleteEmptyMiddleListItem: Command = (state, dispatch) => {
  const { selection } = state
  if (!(selection instanceof TextSelection) || !selection.$cursor) return false
  const { $cursor } = selection
  if ($cursor.depth < 3 || $cursor.parent.type.name !== 'paragraph' || $cursor.parent.content.size !== 0) {
    return false
  }

  const itemDepth = $cursor.depth - 1
  const listDepth = itemDepth - 1
  const item = $cursor.node(itemDepth)
  const list = $cursor.node(listDepth)
  const expectedItem =
    list.type.name === 'taskList'
      ? 'taskItem'
      : ['orderedList', 'bulletList'].includes(list.type.name)
        ? 'listItem'
        : null
  const index = $cursor.index(listDepth)
  // A blank first paragraph may still own nested lists, images or more paragraphs.
  if (item.type.name !== expectedItem || item.childCount !== 1 || index === 0 || index === list.childCount - 1) {
    return false
  }

  if (dispatch) {
    const from = $cursor.before(itemDepth)
    const tr = closeHistory(state.tr).delete(from, $cursor.after(itemDepth))
    // Keep the caret at the next item's start so typing continues in the renumbered item.
    tr.setSelection(TextSelection.near(tr.doc.resolve(from), 1))
    dispatch(tr.scrollIntoView())
  }
  return true
}

export const DeleteEmptyListItem = Extension.create({
  name: 'nookDeleteEmptyListItem',
  // Run before TipTap's ListKeymap and branching Delete keymaps (priority 101).
  priority: 110,
  addKeyboardShortcuts() {
    const remove = () => deleteEmptyMiddleListItem(this.editor.state, tr => this.editor.view.dispatch(tr))
    return { Backspace: remove, Delete: remove }
  },
})
