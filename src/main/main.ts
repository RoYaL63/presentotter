import { app, BrowserWindow, ipcMain, screen, type WebContents } from 'electron'
import path from 'path'

/**
 * PresentOtter main process.
 *
 * Spawns two coordinated windows:
 *
 * 1. **Toolbar** — small, frameless, transparent, always-on-top. Hosts the
 *    annotation tools and the recording controls. Visible on top of any other
 *    app (Google Meet, Zoom, Teams) so the user can drive PresentOtter while
 *    sharing their screen elsewhere.
 *
 * 2. **Overlay** — fullscreen, frameless, transparent, always-on-top. Acts as
 *    a click-through drawing canvas: it captures pointer events only when the
 *    toolbar selects a drawing tool ("interactive mode"); otherwise it lets
 *    clicks fall through to whatever is below. Anything drawn on it is part
 *    of the screen pixels — therefore captured by any screen-share tool.
 *
 * The toolbar issues IPC commands; the main process forwards them to the
 * overlay's WebContents.
 */

let toolbarWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null

const isDev = !app.isPackaged
const DEV_URL = 'http://localhost:5173'

function rendererUrl(hash: 'toolbar' | 'overlay' | 'console'): string {
  if (isDev) {
    return `${DEV_URL}/#${hash}`
  }
  const filePath = path.join(__dirname, '..', 'renderer', 'index.html')
  return `file://${filePath}#${hash}`
}

function getWindowRole(wc: WebContents): 'toolbar' | 'overlay' | 'console' {
  if (toolbarWindow && wc.id === toolbarWindow.webContents.id) return 'toolbar'
  if (overlayWindow && wc.id === overlayWindow.webContents.id) return 'overlay'
  return 'console'
}

function createOverlayWindow(): BrowserWindow {
  const primary = screen.getPrimaryDisplay()
  const { x, y, width, height } = primary.workArea

  const win = new BrowserWindow({
    x,
    y,
    width,
    height,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      backgroundThrottling: false
    }
  })

  // Float above almost everything (above screen-saver level on Windows).
  win.setAlwaysOnTop(true, 'screen-saver')
  // Click-through by default; the toolbar will flip this when a tool is picked.
  win.setIgnoreMouseEvents(true, { forward: true })
  // Visible across virtual desktops / Spaces (no-op on Windows, useful on macOS).
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

  void win.loadURL(rendererUrl('overlay'))

  win.once('ready-to-show', () => win.showInactive())
  win.on('closed', () => {
    overlayWindow = null
  })

  return win
}

function createToolbarWindow(): BrowserWindow {
  const primary = screen.getPrimaryDisplay()
  const { x, width } = primary.workArea
  const TOOLBAR_W = 720
  const TOOLBAR_H = 88

  const win = new BrowserWindow({
    x: x + Math.floor((width - TOOLBAR_W) / 2),
    y: 24,
    width: TOOLBAR_W,
    height: TOOLBAR_H,
    frame: false,
    transparent: true,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: false,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.setAlwaysOnTop(true, 'screen-saver')

  void win.loadURL(rendererUrl('toolbar'))

  win.once('ready-to-show', () => win.show())
  win.on('closed', () => {
    toolbarWindow = null
    if (overlayWindow !== null) {
      overlayWindow.close()
    }
  })

  if (isDev) {
    win.webContents.openDevTools({ mode: 'detach' })
  }

  return win
}

function forwardToOverlay<T>(channel: string, payload?: T): void {
  if (overlayWindow === null || overlayWindow.isDestroyed()) return
  overlayWindow.webContents.send(channel, payload)
}

function registerIpcHandlers(): void {
  // Identify the calling window's role
  ipcMain.handle('window:get-role', (event) => getWindowRole(event.sender))

  // App version (kept simple — no extra package import)
  ipcMain.handle('app:version', () => app.getVersion())

  // Toolbar → Overlay : tool / color / opacity / stroke / clear / undo
  ipcMain.on('overlay:set-tool', (_e, tool: string) =>
    forwardToOverlay('overlay:set-tool', tool)
  )
  ipcMain.on('overlay:set-color', (_e, hex: string) =>
    forwardToOverlay('overlay:set-color', hex)
  )
  ipcMain.on('overlay:set-opacity', (_e, value: number) =>
    forwardToOverlay('overlay:set-opacity', value)
  )
  ipcMain.on('overlay:set-stroke', (_e, width: number) =>
    forwardToOverlay('overlay:set-stroke', width)
  )
  ipcMain.on('overlay:clear', () => forwardToOverlay('overlay:clear'))
  ipcMain.on('overlay:undo', () => forwardToOverlay('overlay:undo'))

  // Overlay interactivity (toggle click-through)
  ipcMain.on('overlay:set-interactive', (_e, interactive: boolean) => {
    if (overlayWindow === null || overlayWindow.isDestroyed()) return
    if (interactive) {
      overlayWindow.setIgnoreMouseEvents(false)
      overlayWindow.setFocusable(true)
    } else {
      overlayWindow.setIgnoreMouseEvents(true, { forward: true })
      overlayWindow.setFocusable(false)
    }
  })

  // Overlay visibility
  ipcMain.on('overlay:set-visible', (_e, visible: boolean) => {
    if (overlayWindow === null || overlayWindow.isDestroyed()) return
    if (visible) overlayWindow.showInactive()
    else overlayWindow.hide()
  })

  // Toolbar window controls
  ipcMain.on('toolbar:minimize', () => {
    if (toolbarWindow === null || toolbarWindow.isDestroyed()) return
    toolbarWindow.setSize(72, 72, true)
  })
  ipcMain.on('toolbar:restore', () => {
    if (toolbarWindow === null || toolbarWindow.isDestroyed()) return
    toolbarWindow.setSize(720, 88, true)
  })
  ipcMain.on('toolbar:close', () => {
    if (toolbarWindow !== null && !toolbarWindow.isDestroyed()) {
      toolbarWindow.close()
    }
  })

  // Console (full app) — opens the multi-page UI from the toolbar
  ipcMain.on('console:open', () => {
    const win = new BrowserWindow({
      width: 1280,
      height: 800,
      minWidth: 1024,
      minHeight: 700,
      backgroundColor: '#050a14',
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false
      }
    })
    void win.loadURL(rendererUrl('console'))
    win.once('ready-to-show', () => win.show())
  })
}

app.whenReady().then(() => {
  registerIpcHandlers()
  overlayWindow = createOverlayWindow()
  toolbarWindow = createToolbarWindow()
}).catch((err: unknown) => {
  console.error('[main] startup failed:', err)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    overlayWindow = createOverlayWindow()
    toolbarWindow = createToolbarWindow()
  }
})
