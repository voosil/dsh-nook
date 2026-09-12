/** Prepare an isolated workspace through the pinned public workspace/create RPC.
 * Native directory pickers require user interaction on some hosts, so they are
 * not part of the Safe UI conversation precondition.
 */
export async function prepareWorkspace(page, path) {
  return page.evaluate(async path => {
    const method = 'workspace/create'
    const response = await fetch(`/api/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({
        type: 'client-request',
        rpcId: crypto.randomUUID(),
        method,
        payload: { args: { request: { path } } },
      }),
    })
    if (!response.ok) throw new Error(`Workspace preparation failed: HTTP ${response.status}`)
    const { result } = await response.json()
    if (!result.ok) throw new Error(`Workspace preparation failed: ${JSON.stringify(result.error)}`)
    return result.value.workspace
  }, path)
}
