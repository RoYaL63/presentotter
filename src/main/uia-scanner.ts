import { spawn, type ChildProcess } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { screen } from 'electron'
import { PATTERNS } from '../agents/sanitizer/patterns'

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
 */

export interface UiaMask {
  x: number
  y: number
  width: number
  height: number
  label: string
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
let onMasksCb: ((masks: UiaMask[]) => void) | null = null
let stdoutBuf = ''

/** Compact entropy/charset test for unknown key-shaped tokens. */
function looksLikeSecret(token: string): boolean {
  const t = token.trim()
  if (t.length < 18 || t.length > 200) return false
  if (!/^[A-Za-z0-9_\-.+/=]+$/.test(t)) return false
  if (/^https?:\/\//i.test(t)) return false
  if (/@/.test(t)) return false
  if (/[\\/]/.test(t) && !/[_\-]/.test(t)) return false // looks like a path
  if (/^\d+$/.test(t)) return false
  const hasLower = /[a-z]/.test(t)
  const hasUpper = /[A-Z]/.test(t)
  const hasDigit = /[0-9]/.test(t)
  const classes = (hasLower ? 1 : 0) + (hasUpper ? 1 : 0) + (hasDigit ? 1 : 0)
  if (classes < 2) return false
  // Shannon entropy
  const freq: Record<string, number> = {}
  for (const c of t) freq[c] = (freq[c] ?? 0) + 1
  let h = 0
  for (const k in freq) {
    const p = (freq[k] ?? 0) / t.length
    h -= p * Math.log2(p)
  }
  return h >= 3.5
}

/** Does this field text contain a secret? Returns a label or null. */
function detect(text: string): string | null {
  for (const pattern of PATTERNS) {
    pattern.regex.lastIndex = 0
    if (pattern.regex.test(text)) return pattern.name
  }
  // Entropy fallback for provider formats we don't enumerate.
  for (const token of text.split(/\s+/)) {
    if (looksLikeSecret(token)) return 'entropy'
  }
  return null
}

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
  const masks: UiaMask[] = []
  for (const raw of els as Array<Record<string, unknown>>) {
    const text = typeof raw.t === 'string' ? raw.t : ''
    if (text.length < 6) continue
    const label = detect(text)
    if (label === null) continue
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
    masks.push({
      x: Math.floor(dip.x),
      y: Math.floor(dip.y),
      width: Math.ceil(dip.width),
      height: Math.ceil(dip.height),
      label: `uia:${label}`
    })
  }
  if (masks.length > 0) onMasksCb?.(masks)
}

export function startUia(onMasks: (masks: UiaMask[]) => void): void {
  if (proc !== null) return
  onMasksCb = onMasks
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
  onMasksCb = null
  stdoutBuf = ''
}

export function isUiaRunning(): boolean {
  return proc !== null
}
