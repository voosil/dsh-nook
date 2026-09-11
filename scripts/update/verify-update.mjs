import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'

/** Run only against a disposable home, after the candidate's source has been removed. */
export async function verifyUpdate(candidate) {
  const { activateProfile } = await import('../../apps/desktop/dist/payload.mjs')
  const { DesktopRuntime } = await import('../../apps/desktop/dist/runtime.mjs')
  const state = await mkdtemp(join(tmpdir(), 'nook-update-smoke-'))
  let runtime
  try {
    const config = await activateProfile({ state, ...candidate.snapshot })
    runtime = new DesktopRuntime(
      config,
      line => console.log(line),
      () => {},
    )
    const url = await runtime.ready
    const exchange = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(10000) })
    const cookie = exchange.headers
      .getSetCookie()
      .map(value => value.split(';')[0])
      .join('; ')
    if (!cookie) throw new Error('Candidate did not establish an authenticated session')
    const response = await fetch(new URL('/', url), { headers: { cookie }, signal: AbortSignal.timeout(10000) })
    if (!response.ok || !(await response.text()).includes('<html')) throw new Error('Candidate web smoke failed')
  } finally {
    await runtime?.stop()
    await rm(state, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await verifyUpdate(JSON.parse(await readFile(process.argv[2], 'utf8')))
}
