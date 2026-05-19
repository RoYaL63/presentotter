; Inno Setup script — PresentOtter Windows installer
;
; Compiles to release/PresentOtter-Setup-{version}.exe — a classic
; double-clickable installer that drops PresentOtter into Program Files,
; creates Start Menu + Desktop shortcuts, and registers an entry in
; "Apps & features" so users can uninstall normally.
;
; Notes
; -----
; - This installer is UNSIGNED. SmartScreen will say "Unrecognized" on
;   first run; user clicks "More info → Run anyway". See docs/SIGNING.md
;   for the long-term plan.
; - PrivilegesRequired=lowest means the installer can run without admin,
;   installing per-user under %LOCALAPPDATA%\Programs\PresentOtter.
;   Avoids UAC prompts and SmartScreen elevation warnings.
; - PrivilegesRequiredOverridesAllowed=dialog lets the user choose
;   "Install for all users" if they prefer (will then ask UAC + install
;   under Program Files).

#define MyAppName "PresentOtter"
#define MyAppVersion "0.1.0"
#define MyAppPublisher "OTTERWISE Solutions"
#define MyAppURL "https://github.com/RoYaL63/presentotter"
#define MyAppExeName "PresentOtter.exe"

[Setup]
AppId={{B0DCCE5C-2D6F-4F19-9A0D-A6F8C1F1D2B4}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
VersionInfoVersion={#MyAppVersion}.0
VersionInfoCompany={#MyAppPublisher}
VersionInfoDescription={#MyAppName} Installer
VersionInfoCopyright=Copyright (C) 2025 {#MyAppPublisher}

; Per-user install by default — no UAC prompt, no admin needed.
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog

; Where the .exe ends up after `iscc`
OutputDir=..\release
OutputBaseFilename=PresentOtter-Setup-{#MyAppVersion}

; Compression
Compression=lzma2
SolidCompression=yes

; UX
WizardStyle=modern
DisableProgramGroupPage=yes
DisableReadyPage=no
DisableWelcomePage=no
ShowLanguageDialog=auto
CloseApplications=force

; Uninstaller
UninstallDisplayIcon={app}\{#MyAppExeName}
UninstallDisplayName={#MyAppName} {#MyAppVersion}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"
Name: "french"; MessagesFile: "compiler:Languages\French.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: checkedonce
Name: "startmenuicon"; Description: "Ajouter dans le menu Démarrer"; GroupDescription: "{cm:AdditionalIcons}"; Flags: checkedonce

[Files]
; Pull the whole packaged bundle (build:main + build:renderer + electron
; runtime) from release/PresentOtter-win32-x64/. The folder MUST exist:
; `npm run pack:win` produces it.
Source: "..\release\PresentOtter-win32-x64\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{userdesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"; Tasks: startmenuicon
Name: "{group}\Désinstaller {#MyAppName}"; Filename: "{uninstallexe}"; Tasks: startmenuicon

[Run]
; Launch the app at the end of the install if the user keeps the
; checkbox ticked.
Filename: "{app}\{#MyAppExeName}"; Description: "Lancer {#MyAppName}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; Wipe the per-user data (Chromium cache, localStorage settings) so an
; uninstall really means clean slate.
Type: filesandordirs; Name: "{localappdata}\PresentOtter"
