import { createWriteStream, type WriteStream } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { taskSnapshot } from './task-connection.js'
import { app, BrowserWindow, Menu, shell, ipcMain, Notification } from 'electron'
import { NoteExports } from './note-export.js'
import type { RuntimeConfig } from './payload.js'
import { canonicalPath, externalUrl, redact, sameRuntimeUrl, within } from './policy.js'
import { DesktopRuntime } from './runtime.js'
import { readActiveUpdate } from './update.js'
import { SharedRuntime } from './shared-client.js'
import { userState } from './shared-paths.js'

async function startDesktop() {
  if (process.platform !== 'darwin' || process.arch !== 'arm64')
    throw new Error('This desktop build currently supports macOS arm64')
  app.setName('Nook')
  const devConfigPath = !app.isPackaged ? process.env.NOOK_DESKTOP_DEV_CONFIG : undefined
  const testRoot = process.argv.includes('--test-mode') ? process.env.NOOK_DESKTOP_TEST_ROOT : undefined
  let state = userState()
  if (testRoot || devConfigPath) {
    state = canonicalPath(testRoot ?? join(resolve(devConfigPath!, '..'), 'electron'))
    if (!within(canonicalPath(tmpdir()), state) && !within(canonicalPath('/private/tmp'), state))
      throw new Error('Desktop verification and development require a temporary directory')
  } else if (!app.isPackaged) throw new Error('Use pnpm desktop:dev to launch an isolated development instance')
  app.setPath('userData', state)
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }

  const statusFile = app.isPackaged
    ? join(process.resourcesPath, 'status', 'index.html')
    : fileURLToPath(new URL('../src/status/index.html', import.meta.url))
  let window: BrowserWindow | undefined
  let runtime: DesktopRuntime | SharedRuntime | undefined
  let log: WriteStream | undefined
  let attempt: Promise<void> | undefined
  let origin: string | undefined
  let quitting = false
  let allowQuit = false
  let shutdown: Promise<void> | undefined
  let startupAbort: AbortController | undefined
  const startupError = '本地服务未能启动。请重试；问题持续时，可从“窗口”菜单查看运行日志。'
  let written = 0
  const writeLog = (message: string) => {
    if (written > 5_000_000) return
    const line = redact(message) + '\n'
    written += Buffer.byteLength(line)
    log?.write(line)
  }
  const closeLog = async () => {
    const current = log
    log = undefined
    if (current) await new Promise<void>(resolveLog => current.end(resolveLog))
  }
  const status = async (kind: string, message = '') => {
    if (!window || window.isDestroyed() || quitting) return
    origin = undefined
    window.webContents.stop()
    await window.loadFile(statusFile, { query: { state: kind, message: redact(message) } })
  }
  const stopRuntime = async (stopBackground = false) => {
    origin = undefined
    const current = runtime
    if (current instanceof SharedRuntime) await current.stop(stopBackground)
    else await current?.stop()
    if (runtime === current) runtime = undefined
    await closeLog()
  }
  const launch = (): Promise<void> =>
    (attempt ??= (async () => {
      await stopRuntime()
      if (quitting) return
      startupAbort = new AbortController()
      let failure: Promise<void> | undefined
      const fail = (error: unknown): Promise<void> =>
        (failure ??= (async () => {
          origin = undefined
          writeLog(String(error))
          await stopRuntime()
          await status('error', startupError)
        })())
      try {
        await status('loading')
        await mkdir(join(state, 'logs'), { recursive: true, mode: 0o700 })
        written = 0
        log = createWriteStream(join(state, 'logs', `runtime-${Date.now()}.log`), { flags: 'wx', mode: 0o600 })
        log.on('error', error => {
          process.stderr.write(`Desktop log unavailable: ${redact(error.message)}\n`)
        })
        const failed = (error: Error) => {
          if (runtime !== current || quitting) return
          window?.webContents.stop()
          void fail(error).catch(error => process.stderr.write(redact(String(error)) + '\n'))
        }
        const current = devConfigPath
          ? new DesktopRuntime(JSON.parse(await readFile(devConfigPath, 'utf8')) as RuntimeConfig, writeLog, failed)
          : new SharedRuntime(
              state,
              async () => {
                const active = await readActiveUpdate(state)
                if (active) return active.launch
                const seed = join(process.resourcesPath, 'runtime')
                return {
                  node: join(seed, 'payload/node/bin/node'),
                  broker: join(seed, 'payload/boot/shared-broker.mjs'),
                  options: { state, seed },
                }
              },
              writeLog,
              failed,
            )
        runtime = current
        const url = await current.ready
        if (quitting || runtime !== current) return
        origin = new URL(url).origin
        await window?.loadURL(url)
        if (!quitting && runtime === current) writeLog('Nook desktop window loaded.')
      } catch (error) {
        await fail(error)
      }
    })().finally(() => {
      attempt = undefined
    }))

  let backgroundTasks = false
  let pollingTasks = false
  const deliveredNotifications = new Set<string>()
  const activeNotifications = new Set<Notification>()
  let taskTimer: ReturnType<typeof setInterval> | undefined
  await app.whenReady()
  const taskHome = devConfigPath
    ? (JSON.parse(await readFile(devConfigPath, 'utf8')) as RuntimeConfig).home
    : join(state, 'harness')
  taskTimer = setInterval(() => {
    if (pollingTasks || quitting) return
    pollingTasks = true
    void taskSnapshot(join(taskHome, 'task-connection.json'))
      .then(tasks => {
        if (quitting) return
        backgroundTasks = tasks.isOwner && tasks.settings.keepAlive
        const pending = tasks.notifications.filter(n => !n.read && !deliveredNotifications.has(n.id))
        for (const n of pending) deliveredNotifications.add(n.id)
        if (pending.length && Notification.isSupported()) {
          const first = pending[0]!
          const notification = new Notification({
            title: pending.length > 1 ? `有 ${pending.length} 项任务需要处理` : first.title,
            body: first.body.slice(0, 300),
          })
          notification.once('click', () => {
            if (window && origin) {
              window.show()
              window.focus()
              void window.loadURL(new URL('/#nook-task=' + encodeURIComponent(first.targetId), origin).href)
            }
          })
          activeNotifications.add(notification)
          notification.once('close', () => {
            activeNotifications.delete(notification)
            notification.removeAllListeners()
          })
          notification.show()
        }
      })
      .catch(() => {})
      .finally(() => {
        pollingTasks = false
      })
  }, 5000)
  window = new BrowserWindow({
    width: 1360,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: 'Nook',
    backgroundColor: '#f7f7f5',
    webPreferences: {
      preload: fileURLToPath(new URL('./preload.cjs', import.meta.url)),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
      devTools: !app.isPackaged || Boolean(testRoot),
    },
  })
  const contents = window.webContents
  const exports = new NoteExports(testRoot || devConfigPath ? join(state, 'exports') : app.getPath('downloads'))
  const authorizeExport = (event: Electron.IpcMainInvokeEvent) => {
    if (
      event.sender !== contents ||
      event.senderFrame !== contents.mainFrame ||
      !sameRuntimeUrl(event.senderFrame.url, origin)
    )
      throw new Error('当前页面无法导出文件。')
  }
  ipcMain.handle('nook:export-note', async (event, request: unknown) => {
    authorizeExport(event)
    return exports.save(request)
  })
  ipcMain.handle('nook:reveal-export', (event, id: unknown) => {
    authorizeExport(event)
    shell.showItemInFolder(exports.path(id))
  })
  const statusUrl = pathToFileURL(statusFile)
  const isStatus = (value: string) => {
    try {
      const url = new URL(value)
      return url.protocol === statusUrl.protocol && url.pathname === statusUrl.pathname && url.host === statusUrl.host
    } catch {
      return false
    }
  }
  const navigate = (event: Electron.Event, url: string) => {
    if (isStatus(contents.getURL()) && isStatus(url) && new URL(url).searchParams.get('action') === 'retry') {
      event.preventDefault()
      void launch()
      return
    }
    if (sameRuntimeUrl(url, origin)) return
    event.preventDefault()
  }
  contents.on('will-navigate', navigate)
  contents.on('will-redirect', navigate)
  contents.setWindowOpenHandler(({ url }) => {
    if (sameRuntimeUrl(contents.getURL(), origin) && externalUrl(url)) {
      void shell.openExternal(url).catch(error => writeLog(String(error)))
    }
    return { action: 'deny' }
  })
  const session = contents.session
  session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
  session.setPermissionCheckHandler(() => false)
  const crashed = () => {
    origin = undefined
    void stopRuntime()
      .then(() => status('error', '页面进程已退出，请重试。'))
      .catch(error => process.stderr.write(redact(String(error)) + '\n'))
  }
  contents.on('render-process-gone', crashed)
  window.once('ready-to-show', () => window?.show())
  window.once('closed', () => {
    ipcMain.removeHandler('nook:export-note')
    ipcMain.removeHandler('nook:reveal-export')
    exports.dispose()
    contents.off('will-navigate', navigate)
    contents.off('will-redirect', navigate)
    contents.off('render-process-gone', crashed)
    session.setPermissionRequestHandler(null)
    session.setPermissionCheckHandler(null)
    window = undefined
  })
  const focus = () => {
    if (window?.isMinimized()) window.restore()
    window?.show()
    window?.focus()
  }
  window.on('close', event => {
    if (!quitting && backgroundTasks) {
      event.preventDefault()
      window?.hide()
    }
  })
  const closed = () => app.quit()
  const beforeQuit = (event: Electron.Event) => {
    if (allowQuit) return
    event.preventDefault()
    quitting = true
    clearInterval(taskTimer)
    for (const notification of activeNotifications) {
      notification.removeAllListeners()
      notification.close()
    }
    activeNotifications.clear()
    startupAbort?.abort()
    origin = undefined
    shutdown ??= (async () => {
      await stopRuntime(true)
      await attempt
      await stopRuntime(true)
      app.off('second-instance', focus)
      app.off('activate', focus)
      app.off('window-all-closed', closed)
      app.off('before-quit', beforeQuit)
      allowQuit = true
      app.quit()
    })()
    void shutdown.catch(error => {
      process.stderr.write(redact(String(error)) + '\n')
      app.exit(1)
    })
  }
  app.on('second-instance', focus)
  app.on('activate', focus)
  app.on('window-all-closed', closed)
  app.on('before-quit', beforeQuit)
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { label: 'Nook', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] },
      { role: 'editMenu' },
      {
        label: '窗口',
        submenu: [
          {
            label: '重新连接本地服务',
            accelerator: 'CmdOrCtrl+Shift+R',
            click: () => {
              void launch()
            },
          },
          { role: 'reload' },
          {
            label: '查看运行日志',
            click: () => {
              void shell.openPath(join(state, 'logs'))
            },
          },
          { role: 'resetZoom' },
          { role: 'zoomIn' },
          { role: 'zoomOut' },
          { role: 'togglefullscreen' },
        ],
      },
    ]),
  )
  await launch()
}

void startDesktop().catch(error => {
  process.stderr.write(redact(String(error)) + '\n')
  app.exit(1)
})
