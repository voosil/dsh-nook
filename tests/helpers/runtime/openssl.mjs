import { execFileSync, spawnSync } from 'node:child_process'
import { join, resolve } from 'node:path'

/** Use the host toolchain, including Git for Windows' bundled OpenSSL. */
export function opensslExecutable(env = process.env) {
  const candidates = ['openssl']
  if (process.platform === 'win32') {
    try {
      const gitExec = execFileSync('git', ['--exec-path'], {
        encoding: 'utf8',
        env,
        windowsHide: true,
        timeout: 5000,
      }).trim()
      candidates.push(resolve(gitExec, '../../../usr/bin/openssl.exe'))
    } catch {
      // Git and OpenSSL may also be installed independently.
    }
    if (env.ProgramFiles) candidates.push(join(env.ProgramFiles, 'Git/usr/bin/openssl.exe'))
    if (env.LOCALAPPDATA) candidates.push(join(env.LOCALAPPDATA, 'Programs/Git/usr/bin/openssl.exe'))
  }
  for (const executable of env.NOOK_TEST_OPENSSL ? [env.NOOK_TEST_OPENSSL] : candidates) {
    const result = spawnSync(executable, ['version'], { env, windowsHide: true, timeout: 5000 })
    if (result.status === 0) return executable
  }
  throw new Error('TLS integration requires OpenSSL; install it or set NOOK_TEST_OPENSSL to its executable.')
}
