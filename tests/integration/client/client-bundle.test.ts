import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { test } from 'node:test'
import vm from 'node:vm'

const require = createRequire(import.meta.url)

interface LoadedModule {
  readonly id: string
  readonly factory: (loader: (id: string) => unknown) => { apply(ctx: unknown): void }
}

async function loadClient(file: string): Promise<LoadedModule> {
  let loaded: LoadedModule | undefined
  const code = await readFile(resolve(file), 'utf8')
  vm.runInNewContext(
    code,
    {
      window: {
        __ModuleLoader__: {
          load(module: LoadedModule) {
            loaded = module
          },
        },
      },
    },
    { filename: file },
  )
  assert.ok(loaded !== undefined)
  return loaded
}

test('built Client plugins use the DSH module-loader closure and verified Slots', async () => {
  const expected = [
    ['packages/ui-sidebar/lib/client.js', '@nook-dsh/ui-sidebar', 'sidebar.footer.action', 'nook'],
    [
      'packages/ui-project/lib/client.js',
      '@nook-dsh/ui-project',
      'conversation.session.header.actions',
      'nook-project-context',
    ],
  ] as const

  for (const [file, packageId, slotName, entryId] of expected) {
    const loaded = await loadClient(file)
    assert.equal(loaded.id, packageId)
    const plugin = loaded.factory(id => require(id))
    const registrations: Array<{ name: string; id?: string }> = []
    const ctx = {
      slots: {
        inject(name: string, mount: () => unknown) {
          assert.equal(name, slotName)
          return mount()
        },
        register(options: { name: string; id?: string }) {
          registrations.push(options)
          return () => undefined
        },
      },
    }
    plugin.apply(ctx)
    assert.equal(registrations.length, 1)
    assert.equal(registrations[0]?.name, slotName)
    assert.equal(registrations[0]?.id, entryId)
    assert.equal((registrations[0] as { order?: number } | undefined)?.order, slotName.startsWith('sidebar') ? -20 : -5)
  }
})
