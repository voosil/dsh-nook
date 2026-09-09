import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { assistantArtifacts } from './artifacts.mjs'

export async function deploymentGuide() {
  const artifact = await assistantArtifacts()
  return {
    version: artifact.version,
    assistantUrl: `https://github.com/voosil/dsh-nook/releases/download/sync-assistant-v${artifact.version}/assistant.py`,
    assistantSha256: createHash('sha256').update(artifact.source).digest('hex'),
    interactiveInstallCommand: artifact.command,
    skill: (
      await readFile(new URL('../../packages/feature-agent/skills/nook-sync-deploy/SKILL.md', import.meta.url), 'utf8')
    ).replaceAll('\r\n', '\n'),
  }
}
