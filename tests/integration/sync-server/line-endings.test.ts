import assert from 'node:assert/strict'

import { test } from 'node:test'

import { readFile } from 'node:fs/promises'

import { createHash } from 'node:crypto'

import { dockerArtifacts, deploymentFiles, assistantArtifacts } from '../../../scripts/sync-server/artifacts.mjs'

import { deploymentGuide } from '../../../scripts/sync-server/agent-guide.mjs'

test('CRLF deployment inputs produce the same archive and published checksum chain as LF', async () => {
  const replacements: Record<string, string> = {}
  for (const name of deploymentFiles)
    replacements[name] = (
      await readFile(new URL('../../../scripts/sync-server/' + name, import.meta.url), 'utf8')
    ).replace(/\r?\n/g, '\r\n')
  assert.deepEqual((await dockerArtifacts(replacements)).archive, (await dockerArtifacts()).archive)
  const artifact = await assistantArtifacts()
  const guide = await deploymentGuide()
  assert.equal(guide.assistantSha256, createHash('sha256').update(artifact.source).digest('hex'))
  assert.equal(guide.interactiveInstallCommand, artifact.command)
  assert.ok(!artifact.source.includes('\r'))
  assert.equal(
    guide.skill,
    (
      await readFile(
        new URL('../../../packages/feature-agent/skills/nook-sync-deploy/SKILL.md', import.meta.url),
        'utf8',
      )
    ).replaceAll('\r\n', '\n'),
  )
})
