import { createRequire } from 'node:module'
import { join } from 'node:path'

/** A kernel Job owns the runtime tree even if the supervisor itself crashes. */
export function windowsJob(profile: string) {
  const require = createRequire(join(profile, 'package.json'))
  const storage = createRequire(require.resolve('@nook-dsh/storage-backup'))
  const koffi = storage('koffi') as typeof import('koffi')
  const library = koffi.load('kernel32.dll')
  const basic = koffi.struct({
    PerProcessUserTimeLimit: 'int64',
    PerJobUserTimeLimit: 'int64',
    LimitFlags: 'uint32',
    MinimumWorkingSetSize: 'size_t',
    MaximumWorkingSetSize: 'size_t',
    ActiveProcessLimit: 'uint32',
    Affinity: 'uintptr',
    PriorityClass: 'uint32',
    SchedulingClass: 'uint32',
  })
  const extended = koffi.struct({
    BasicLimitInformation: basic,
    IoInfo: koffi.array('uint64', 6),
    ProcessMemoryLimit: 'size_t',
    JobMemoryLimit: 'size_t',
    PeakProcessMemoryUsed: 'size_t',
    PeakJobMemoryUsed: 'size_t',
  })
  const create = library.func('__stdcall', 'CreateJobObjectW', 'intptr', ['void*', 'str16'])
  const set = library.func('__stdcall', 'SetInformationJobObject', 'int', ['intptr', 'int', 'void*', 'uint32'])
  const open = library.func('__stdcall', 'OpenProcess', 'intptr', ['uint32', 'int', 'uint32'])
  const assign = library.func('__stdcall', 'AssignProcessToJobObject', 'int', ['intptr', 'intptr'])
  const close = library.func('__stdcall', 'CloseHandle', 'int', ['intptr'])
  const lastError = library.func('__stdcall', 'GetLastError', 'uint32', [])
  let handle = create(null, null)
  const dispose = () => {
    if (!handle) return
    close(handle)
    handle = 0
    library.unload()
  }
  try {
    if (!handle) throw new Error(`CreateJobObjectW failed (${lastError()})`)
    const limits = Buffer.alloc(koffi.sizeof(extended))
    // Struct layout comes from Koffi, including pointer-size alignment.
    limits.writeUInt32LE(
      0x2000,
      koffi.offsetof(extended, 'BasicLimitInformation') + koffi.offsetof(basic, 'LimitFlags'),
    )
    if (!set(handle, 9, limits, limits.length)) throw new Error(`SetInformationJobObject failed (${lastError()})`)
    return {
      assign(pid: number) {
        const child = open(0x0100 | 0x0001, 0, pid)
        if (!child) throw new Error(`OpenProcess failed (${lastError()})`)
        try {
          if (!assign(handle, child)) throw new Error(`AssignProcessToJobObject failed (${lastError()})`)
        } finally {
          close(child)
        }
      },
      dispose,
    }
  } catch (error) {
    if (handle) dispose()
    else library.unload()
    throw error
  }
}
