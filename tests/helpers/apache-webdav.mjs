import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createServer } from 'node:net'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/** macOS reference: stock Apache 2.4 mod_dav, one request worker, disposable loopback share. */
export async function startApacheWebDav() {
  const root = await mkdtemp(join(tmpdir(), 'nook-apache-dav-'))
  const reservation = createServer()
  reservation.listen(0, '127.0.0.1')
  await once(reservation, 'listening')
  const port = reservation.address().port
  await new Promise(resolve => reservation.close(resolve))
  await mkdir(join(root, 'data'))
  const config = join(root, 'httpd.conf')
  await writeFile(
    config,
    `ServerRoot /usr
Listen 127.0.0.1:${port}
ServerName 127.0.0.1
PidFile "${root}/httpd.pid"
ErrorLog "${root}/error.log"
KeepAlive Off
LoadModule mpm_prefork_module libexec/apache2/mod_mpm_prefork.so
LoadModule authz_core_module libexec/apache2/mod_authz_core.so
LoadModule unixd_module libexec/apache2/mod_unixd.so
LoadModule dav_module libexec/apache2/mod_dav.so
LoadModule dav_fs_module libexec/apache2/mod_dav_fs.so
DavLockDB "${root}/DavLock"
DocumentRoot "${root}/data"
<Directory "${root}/data">
Require all granted
Dav On
</Directory>
`,
  )
  const child = spawn('/usr/sbin/httpd', ['-X', '-f', config], { stdio: ['ignore', 'pipe', 'pipe'] })
  let logs = '',
    failure
  const collect = data => {
    logs += data
  }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)
  child.on('error', error => {
    failure = error
  })
  const closed = once(child, 'close').catch(() => {})
  const close = async () => {
    if (child.exitCode === null && child.signalCode === null && !failure) child.kill('SIGTERM')
    await closed
    child.stdout.off('data', collect)
    child.stderr.off('data', collect)
    await rm(root, { recursive: true, force: true })
  }
  try {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (failure || child.exitCode !== null) throw failure ?? new Error(logs)
      try {
        await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(500) })
        return { url: `http://127.0.0.1:${port}/nook/`, close }
      } catch {
        await new Promise(resolve => setTimeout(resolve, 50))
      }
    }
    throw new Error('Apache WebDAV did not start')
  } catch (error) {
    await close()
    throw error
  }
}
