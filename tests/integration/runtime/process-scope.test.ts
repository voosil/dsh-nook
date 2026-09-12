import assert from 'node:assert/strict'

import { test } from 'node:test'

import { once } from 'node:events'

import { setTimeout as delay } from 'node:timers/promises'

import { ProcessScope } from '../../../scripts/shared/process-scope.mjs'

test(
  'Windows build cancellation reaps the owned subprocess tree',
  { skip: process.platform !== 'win32', timeout: 10_000 },
  async () => {
    const scope = new ProcessScope()
    try {
      const child = scope.spawn(
        process.execPath,
        [
          '-e',
          `
      const {spawn}=require('node:child_process');
      const worker=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});
      console.log(worker.pid); setInterval(()=>{},1000);
    `,
        ],
        { stdio: ['ignore', 'pipe', 'pipe'] },
      )
      const [chunk] = await once(child.stdout, 'data')
      const pid = Number(chunk.toString().trim())
      assert.ok(pid > 1)
      await scope.stop(child)
      for (let attempt = 0; attempt < 50; attempt++) {
        try {
          process.kill(pid, 0)
        } catch (error) {
          assert.equal(error.code, 'ESRCH')
          return
        }
        await delay(20)
      }
      assert.fail('Build descendant survived cancellation')
    } finally {
      await scope.dispose()
    }
  },
)
