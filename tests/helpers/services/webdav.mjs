import { createServer } from 'node:http'
import { createServer as createHttpsServer } from 'node:https'
import { createHash } from 'node:crypto'
/** Disposable HTTP fixture, with fault modes for interoperability tests. */
export async function startWebDav({ brokenConditions = false, auth = 'tester:secret', tls } = {}) {
  const data = new Map()
  const methods = []
  const handler = async (request, response) => {
    const path = new URL(request.url, 'http://fixture').pathname
    methods.push([request.method, path])
    if (request.headers.authorization !== `Basic ${Buffer.from(auth).toString('base64')}`) {
      response.writeHead(401).end()
      return
    }
    if (request.method === 'MKCOL') {
      response.writeHead(201).end()
      return
    }
    if (request.method === 'DELETE') {
      data.delete(path)
      response.writeHead(204).end()
      return
    }
    if (request.method === 'GET') {
      const item = data.get(path)
      if (!item) {
        response.writeHead(404).end()
        return
      }
      response.writeHead(200, { ETag: item.etag }).end(item.bytes)
      return
    }
    if (request.method === 'PUT') {
      const chunks = []
      for await (const chunk of request) chunks.push(chunk)
      const current = data.get(path)
      if (
        !brokenConditions &&
        ((request.headers['if-none-match'] === '*' && current) ||
          (request.headers['if-match'] && request.headers['if-match'] !== current?.etag))
      ) {
        response.writeHead(412).end()
        return
      }
      const bytes = Buffer.concat(chunks),
        etag = `"${createHash('sha256').update(bytes).digest('hex')}"`
      data.set(path, { bytes, etag })
      response.writeHead(201, { ETag: etag }).end()
      return
    }
    response.writeHead(405).end()
  }
  const server = tls ? createHttpsServer(tls, handler) : createServer(handler)
  let connections = 0
  const connected = () => connections++
  server.on('connection', connected)
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const url = `${tls ? 'https' : 'http'}://127.0.0.1:${server.address().port}/nook/`
  return {
    url,
    data,
    methods,
    connections: () => connections,
    close: () =>
      new Promise(resolve => {
        server.close(() => {
          server.removeListener('connection', connected)
          resolve()
        })
        server.closeAllConnections()
      }),
  }
}
