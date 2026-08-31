const EXPECTED_STALE_PEERS = new Set(['@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-tools'])

/** Fail unless pnpm reports only the reviewed community-browser peer mismatch. */
export function assertKnownPeerWarnings(output) {
  const found = output
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.startsWith('✕ unmet peer '))
    .map(line => line.slice('✕ unmet peer '.length))
  if (found.length !== EXPECTED_STALE_PEERS.size || found.some(name => !EXPECTED_STALE_PEERS.has(name))) {
    throw new Error(`unexpected peer dependency result\n${output}`)
  }
  if (!output.includes('dsh-browser-playwright@0.1.1')) {
    throw new Error(`known stale peer warnings are not attributed to dsh-browser-playwright@0.1.1\n${output}`)
  }
}
