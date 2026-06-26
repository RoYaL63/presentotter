import { spawn, type ChildProcess } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { screen } from 'electron'

/**
 * UI Automation scanner — the FAST detection path (alongside OCR).
 *
 * Windows UI Automation (UIA) is the built-in accessibility API: free, no
 * install, no native addon. We drive it from a persistent PowerShell child
 * process (.NET System.Windows.Automation) that, every ~500 ms, reads the
 * text of the FOREGROUND window's input fields (Edit / ComboBox) + their
 * on-screen rectangles and prints them as JSON lines.
 *
 * Main then runs the shared secret PATTERNS over each field's text and, on a
 * match, emits a mask at that field's rectangle (converted physical→DIP via
 * Electron's screen API). This is instant + exact (no OCR), and very light:
 * it only walks the active window's fields, not the whole screen.
 *
 * OCR stays as the universal fallback for rendered text / canvas / page
 * content that has no accessible value (hybrid mode runs both).
 *
 * This module is a THIN OS bridge only: it collects {text, rect} and hands
 * them to the renderer, which runs the secret detection (so the main-process
 * tsc build stays self-contained — no cross-package import).
 */

/** A text-bearing UI element + its rect already in virtual-screen DIP. */
export interface UiaElement {
  text: string
  x: number
  y: number
  width: number
  height: number
}

// PowerShell UIA loop. Scoped to the foreground window, Edit + ComboBox
// controls only, with a CacheRequest so each scan is a single bulk
// cross-process fetch (fast). Emits one compact JSON line per tick.
const PS_SCRIPT = `
$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -Namespace PO -Name Native -MemberDefinition @'
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool SetProcessDpiAwarenessContext(System.IntPtr value);
'@
# PER_MONITOR_AWARE_V2 (-4): UIA BoundingRectangle then comes back in true
# physical pixels, so the physical->DIP conversion on the Node side lands
# the masks correctly on every monitor regardless of its scale.
try { [void][PO.Native]::SetProcessDpiAwarenessContext([System.IntPtr](-4)) } catch {}
$AE = [System.Windows.Automation.AutomationElement]
$TS = [System.Windows.Automation.TreeScope]
$CT = [System.Windows.Automation.ControlType]
$VP = [System.Windows.Automation.ValuePattern]
$condEdit = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, $CT::Edit)
$condCombo = New-Object System.Windows.Automation.PropertyCondition($AE::ControlTypeProperty, $CT::ComboBox)
$cond = New-Object System.Windows.Automation.OrCondition($condEdit, $condCombo)
$cache = New-Object System.Windows.Automation.CacheRequest
$cache.Add($AE::NameProperty)
$cache.Add($AE::BoundingRectangleProperty)
$cache.Add($VP::ValueProperty)
$cache.AutomationElementMode = [System.Windows.Automation.AutomationElementMode]::None
$NS = [System.Windows.Automation.AutomationElement]::NotSupported
while ($true) {
  try {
    $h = [PO.Native]::GetForegroundWindow()
    if ($h -ne [System.IntPtr]::Zero) {
      $root = $AE::FromHandle($h)
      if ($root -ne $null) {
        $act = $cache.Activate()
        $found = $null
        try { $found = $root.FindAll($TS::Descendants, $cond) } finally { $act.Dispose() }
        $items = New-Object System.Collections.ArrayList
        if ($found -ne $null) {
          foreach ($el in $found) {
            $r = $el.Cached.BoundingRectangle
            if ($r.Width -le 1 -or $r.Height -le 1) { continue }
            if ([double]::IsInfinity($r.X) -or [double]::IsInfinity($r.Y)) { continue }
            $v = $el.GetCachedPropertyValue($VP::ValueProperty)
            if ($v -eq $NS) { $v = $null }
            $n = $el.Cached.Name
            $t = if ([string]::IsNullOrEmpty($v)) { $n } else { $v }
            if ([string]::IsNullOrEmpty($t)) { continue }
            [void]$items.Add([pscustomobject]@{ t = $t; x = [int][math]::Round($r.X); y = [int][math]::Round($r.Y); w = [int][math]::Round($r.Width); h = [int][math]::Round($r.Height) })
          }
        }
        $out = [pscustomobject]@{ els = @($items) } | ConvertTo-Json -Compress -Depth 4
        [Console]::Out.WriteLine($out)
        [Console]::Out.Flush()
      }
    }
  } catch {}
  Start-Sleep -Milliseconds 500
}
`

let proc: ChildProcess | null = null
let onElementsCb: ((els: UiaElement[]) => void) | null = null
let stdoutBuf = ''

function handleLine(line: string): void {
  const s = line.trim()
  if (s.length === 0) return
  let parsed: { els?: unknown } | null = null
  try {
    parsed = JSON.parse(s) as { els?: unknown }
  } catch {
    return // malformed line — ignore
  }
  let els = parsed?.els
  if (els === undefined || els === null) return
  if (!Array.isArray(els)) els = [els]
  const out: UiaElement[] = []
  for (const raw of els as Array<Record<string, unknown>>) {
    const text = typeof raw.t === 'string' ? raw.t : ''
    if (text.length < 4) continue
    const phys = {
      x: Math.round(Number(raw.x) || 0),
      y: Math.round(Number(raw.y) || 0),
      width: Math.round(Number(raw.w) || 0),
      height: Math.round(Number(raw.h) || 0)
    }
    if (phys.width <= 0 || phys.height <= 0) continue
    let dip = phys
    try {
      dip = screen.screenToDipRect(null, phys)
    } catch {
      /* fall back to physical if conversion unavailable */
    }
    out.push({
      text,
      x: Math.floor(dip.x),
      y: Math.floor(dip.y),
      width: Math.ceil(dip.width),
      height: Math.ceil(dip.height)
    })
  }
  if (out.length > 0) onElementsCb?.(out)
}

export function startUia(onElements: (els: UiaElement[]) => void): void {
  if (proc !== null) return
  onElementsCb = onElements
  stdoutBuf = ''
  const file = path.join(os.tmpdir(), 'presentotter-uia.ps1')
  try {
    writeFileSync(file, PS_SCRIPT, 'utf8')
  } catch (err) {
    console.error('[uia] cannot write script:', err)
    return
  }
  try {
    proc = spawn(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        file
      ],
      { windowsHide: true }
    )
  } catch (err) {
    console.error('[uia] spawn failed:', err)
    proc = null
    return
  }
  proc.stdout?.setEncoding('utf8')
  proc.stdout?.on('data', (chunk: string) => {
    stdoutBuf += chunk
    let nl: number
    while ((nl = stdoutBuf.indexOf('\n')) >= 0) {
      const line = stdoutBuf.slice(0, nl)
      stdoutBuf = stdoutBuf.slice(nl + 1)
      handleLine(line)
    }
  })
  proc.stderr?.on('data', (d: Buffer) => {
    const msg = d.toString().trim()
    if (msg.length > 0) console.error('[uia:ps]', msg.slice(0, 300))
  })
  proc.on('exit', () => {
    proc = null
  })
  proc.on('error', (err) => {
    console.error('[uia] process error:', err)
    proc = null
  })
}

export function stopUia(): void {
  if (proc !== null) {
    try {
      proc.kill()
    } catch {
      /* already gone */
    }
    proc = null
  }
  onElementsCb = null
  stdoutBuf = ''
}

export function isUiaRunning(): boolean {
  return proc !== null
}
