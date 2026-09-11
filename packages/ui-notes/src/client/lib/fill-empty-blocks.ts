import { Extension } from '@tiptap/core'
import { Fragment } from '@tiptap/pm/model'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { Transform } from '@tiptap/pm/transform'

/**
 * 补全「内容为空但 schema 要求至少一个子节点」的容器节点。
 *
 * 背景：`@tiptap/markdown` 的 orderedList 自定义 tokenizer 对空列表项
 * （如 `1. xxx` 换行后未输入内容的 `2. `）产出 `tokens: []` 的 list_item，
 * 而 extension-list 的 parseListItems 直接构造 listItem 节点，缺少
 * ListItem.parseMarkdown 那条空段落兜底，得到 `listItem content: []`。
 * 该形状违反 schema 的 `paragraph block*`：DOM 里是空 `<li>`，光标无法
 * 定位其中、无法输入，且 getMarkdown() 在 renderNestedMarkdownContent
 * 解构到 undefined 时直接抛错。任务项与无序列表的解析路径自带兜底，
 * 不受影响。
 *
 * 修复不针对具体节点类型：凡 schema 允许 `fillBefore` 推出非空必填内容的
 * 空节点一律用 `createAndFill` 补齐，因此只能产出 schema 合法的节点，
 * 同时覆盖 listItem、taskItem、blockquote 等未来可能出现的同类缺口。
 */

const fillEmptyBlocksPluginKey = new PluginKey('nookFillEmptyBlocks')

interface EmptyBlockFix {
  pos: number
  node: ProseMirrorNode
}

function collectEmptyRequiredBlocks(doc: ProseMirrorNode): EmptyBlockFix[] {
  const fixes: EmptyBlockFix[] = []

  doc.descendants((node, pos) => {
    if (node.content.size > 0) {
      return
    }

    const fill = node.type.contentMatch.fillBefore(Fragment.empty, true)

    if (fill && fill.size > 0) {
      fixes.push({ pos, node })
    }
  })

  return fixes
}

function fillEmptyBlocks(transform: Transform): void {
  const fixes = collectEmptyRequiredBlocks(transform.doc)

  // 从后往前替换：后面位置的变化不影响前面的位置
  for (const { pos, node } of fixes.reverse()) {
    const filled = node.type.createAndFill(node.attrs, undefined, node.marks)

    if (filled) {
      transform.replaceWith(pos, pos + node.nodeSize, filled)
    }
  }
}

/**
 * 返回补全后的文档；文档合法时返回 null，调用方据此跳过后续工作。
 */
export function fixEmptyBlocks(doc: ProseMirrorNode): ProseMirrorNode | null {
  const transform = new Transform(doc)
  fillEmptyBlocks(transform)
  return transform.docChanged ? transform.doc : null
}

/**
 * 供 EditorState 直接装配，node 环境可测：任何 docChanged 的事务之后
 * 都保证文档满足 schema 的必填内容约束。
 */
export function createFillEmptyBlocksPlugin(): Plugin {
  return new Plugin({
    key: fillEmptyBlocksPluginKey,
    appendTransaction: (transactions, _oldState, newState: EditorState): Transaction | null => {
      if (!transactions.some(transaction => transaction.docChanged)) {
        return null
      }

      // 直接在事务上补齐局部节点，让选区随局部 step map 移动；
      // 整篇替换会把 RichEditor 恢复的光标或选区推到文末。
      const transaction = newState.tr
      fillEmptyBlocks(transaction)
      return transaction.docChanged ? transaction : null
    },
  })
}

export const FillEmptyBlocks = Extension.create({
  name: 'fillEmptyBlocks',

  // 需排在 Markdown 扩展之后：其 onBeforeCreate 先把 options.content 解析成
  // JSON（含损坏的空列表项），这里赶在 createDoc 之前修复，保证初始文档合法，
  // 否则组件首个 getMarkdown()（content-sync effect）就会抛错。
  onBeforeCreate() {
    const content = this.editor.options.content

    if (typeof content !== 'object' || content === null) {
      return
    }

    try {
      const fixed = fixEmptyBlocks(this.editor.schema.nodeFromJSON(content))

      if (fixed) {
        this.editor.options.content = fixed.toJSON()
      }
    } catch {
      // 非标准 JSON 形状交给 createDoc 自身的兜底逻辑处理
    }
  },

  addProseMirrorPlugins() {
    return [createFillEmptyBlocksPlugin()]
  },
})
