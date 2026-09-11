import { readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'

const noteId = index => `d3e00000-0000-4000-8000-${String(index).padStart(12, '0')}`
const personal = { kind: 'personal', url: null, author: null, basedOn: [] }

/** Only called while the launcher owns its isolated development home. */
export async function seedDevData(home, { force = false } = {}) {
  const receiptPath = join(home, 'dev-seed.json')
  const receipt = await readFile(receiptPath, 'utf8')
    .then(JSON.parse)
    .catch(error => {
      if (error.code !== 'ENOENT') throw error
      return { version: 1, projects: {}, complete: false }
    })
  if (receipt.version !== 1) throw new Error('Unsupported development seed receipt')
  if (receipt.complete && !force) return
  // Import after the launcher's build, so a clean checkout needs no compiled files on entry.
  const { Context } = await import('@deepseek-ai/cordis')
  const Notebook = await import('../../packages/provider-notebook-local/lib/index.js')
  const { default: Notes } = await import('../../packages/feature-notes/lib/index.js')
  const { default: Tasks } = await import('../../packages/provider-task-sync/lib/index.js')
  const { newTask } = await import('../../packages/feature-tasks/lib/engine.js')
  const { taskInputSchema, defaultSettings } = await import('../../packages/capability-task/lib/index.js')
  const saveReceipt = async () => {
    const temporary = `${receiptPath}.${process.pid}.tmp`
    await writeFile(temporary, JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 })
    await rename(temporary, receiptPath)
  }
  const ctx = new Context()
  try {
    await ctx.plugin(Notebook, {
      file: join(home, 'nook/notebook.sqlite'),
      projectsFile: join(home, 'nook/projects.json'),
    })
    await ctx.plugin(Notes)
    await ctx.plugin(Tasks, { identity: join(home, 'nook-task-device-id') })
    const notes = ctx.nookNotebook
    for (const [key, name, description] of [
      ['work', '产品设计', '页面布局、交互细节与迭代记录'],
      ['reading', '阅读与思考', '阅读摘记、长文与个人想法'],
      ['empty', '留白项目', '用于检查项目空态，可自由添加内容'],
    ]) {
      if (receipt.projects[key]) continue
      // A crash between creation and receipt publication can recover by the fixture's name.
      const existing = (await notes.projects()).find(
        project => project.name === name && project.description === description,
      )
      receipt.projects[key] = (existing ?? (await notes.createProject({ name, description }))).id
      await saveReceipt()
    }
    const project = async key => ((await ctx.nookProjects.get(receipt.projects[key])) ? receipt.projects[key] : null)
    const work = await project('work'),
      reading = await project('reading')
    const longText = Array.from(
      { length: 24 },
      (_, index) =>
        `## 第 ${index + 1} 段：观察与记录\n\n调试一个记录工具，需要观察真实内容如何呈现。段落、标点与留白共同决定阅读的节奏。这里保留足够长的文字，用来检查滚动、编辑、保存和全文检索。\n\n> 把想法写下来，再慢慢整理。`,
    ).join('\n\n')
    const examples = [
      [
        '欢迎来到开发工作区',
        '# 可以直接开始调试\n\n这里的项目、笔记与任务都是示例，可自由修改。重启开发环境会保留你的内容。\n\n- 打开一篇笔记并编辑\n- 在项目之间移动内容\n- 搜索“阅读节奏”\n- 查看任务和回收站\n\n模型可在开发环境单独配置一次。',
        work,
        true,
      ],
      [
        'Markdown 排版样本',
        '# 排版检查\n\n包含 **粗体**、*斜体*、`行内代码`。\n\n## 待办清单\n\n- [x] 检查标题\n- [ ] 检查编辑和保存\n\n1. 第一步\n2. 第二步\n\n> 一段引用文字。\n\n```js\nconst message = "你好，Nook"\n```\n\n---\n\n[示例链接](https://example.com)',
        work,
        false,
      ],
      ['阅读节奏：一篇用于检查滚动、长文编辑和搜索结果的完整记录', longText, reading, false],
      ['今天的小发现', '短笔记也有价值。记录一个想法，之后再展开。', reading, false],
      [
        '这是一条很长很长的标题，用于观察窄窗口、侧栏列表和编辑页标题在空间不足时的换行与截断表现',
        '长标题示例正文。',
        work,
        false,
      ],
      ['', '', null, false],
      ['尚未分类的灵感', '这篇笔记没有归属项目，可以测试移动和筛选。', null, false],
      ['可以恢复的示例笔记', '这条笔记放在回收站里，用于检查恢复流程。', reading, false],
    ]
    for (const [index, [title, markdown, projectId, pinned]] of examples.entries()) {
      const id = noteId(index + 1)
      if (await notes.get(id)) continue
      const note = await notes.create({ id, title, markdown, projectId, pinned, source: personal })
      if (index === examples.length - 1) await notes.setDeleted(id, note.revision, true)
    }
    const store = ctx.nookTaskStore
    const now = Date.now()
    const taskExamples = [
      ['检查笔记编辑与自动保存', 'todo', 'human', 'task', work],
      ['整理阅读摘记', 'paused', 'human', 'task', reading],
      ['完成第一轮界面检查', 'done', 'human', 'task', work],
      ['思考下一阶段的产品方向', 'unscheduled', 'unassigned', 'plan', null],
    ]
    const writes = []
    if (!store.get('task-settings', 'settings') && !store.list('task').length) {
      writes.push({ type: 'task-settings', value: { ...defaultSettings(), revision: 1, ownerId: store.deviceId } })
    }
    for (const [index, [title, status, assignee, kind, projectId]] of taskExamples.entries()) {
      const id = `dev-example-task-${index + 1}`
      if (store.get('task', id)) continue
      const task = newTask(
        id,
        taskInputSchema.parse({
          title,
          assignee,
          kind,
          projectId,
          description: '这是可编辑的开发示例，不会自动执行。',
          acceptance: '完成后手动确认结果。',
        }),
        now,
        index,
      )
      writes.push({
        type: 'task',
        value: {
          ...task,
          status,
          history: [...task.history, { at: new Date(now).toISOString(), action: 'seed', detail: '开发示例状态' }],
        },
      })
    }
    // Use the validated Capability store; no scheduler, model, or remote sync service is mounted.
    if (writes.length) store.write(writes)
    receipt.complete = true
    await saveReceipt()
  } finally {
    await ctx.fiber.dispose()
  }
}
