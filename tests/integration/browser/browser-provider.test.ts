import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { Context } from '@deepseek-ai/cordis'
import BrowserRuntime from 'dsh-browser-playwright/service'
import * as PlaywrightPlugin from 'dsh-browser-playwright/playwright'
import CommunityBrowserAdapter from '../../../packages/adapter-browser-community/src/index.ts'

test('real community provider works through the Nook adapter', async () => {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(
      '<!doctype html><html><head><title>Nook integration</title></head><body><h1>Quiet corner</h1><button>Open shelf</button></body></html>',
    )
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address !== null && typeof address === 'object')
  const url = `http://127.0.0.1:${address.port}/`
  const ctx = new Context()

  try {
    await ctx.plugin(BrowserRuntime, { provider: 'playwright' })
    await ctx.plugin(PlaywrightPlugin, {
      launch: {
        channel: 'chrome',
        headless: true,
        viewport: { width: 960, height: 640 },
        navigationTimeoutMs: 10_000,
        ignoreHTTPSErrors: false,
      },
      allowedDomains: ['127.0.0.1'],
      idleTimeoutMs: 0,
      maxSessions: 2,
      snapshot: { maxNodes: 100, maxNameLength: 120, maxTextLength: 300 },
    })
    await ctx.plugin(CommunityBrowserAdapter)

    const snapshot = await ctx.nookBrowser.navigate('integration-owner', url, 'load')
    assert.equal(snapshot.title, 'Nook integration')
    assert.ok(JSON.stringify(snapshot.nodes).includes('Quiet corner'))
    const screenshot = await ctx.nookBrowser.screenshot('integration-owner', { fullPage: true })
    assert.equal(screenshot.mimeType, 'image/png')
    assert.ok(Buffer.from(screenshot.dataBase64, 'base64').byteLength > 100)
    await ctx.nookBrowser.release('integration-owner')
  } finally {
    await ctx.fiber.dispose()
    await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())))
  }
})
