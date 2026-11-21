// Static rules of the agent's Rust and Tauri sources (AGS-01, AGS-04, AGS-15, AGS-21, AGS-22, AGS-33). Each rule is checked
// on the repository as it is, and on a fixture under scripts/test/fixtures/agent-rules/ that the rule must reject.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const agentTauri = 'apps/agent/src-tauri';
const readText = (file) => readFileSync(path.join(root, file), 'utf8');
const readJson = (file) => JSON.parse(readText(file));

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src ipc: http://ipc.localhost";

// The app's `windows` crate features (design.md § Read-only boundary).
const WINDOWS_FEATURE_ALLOW_LIST = [
  'Win32_Foundation',
  'Win32_System_Diagnostics_ToolHelp',
  'Media_Ocr',
  'Graphics_Imaging',
  'Globalization',
  'Foundation',
  'Storage_Streams',
  // The window capture (CHR-03): GDI for the client bitmap, PrintWindow (Storage::Xps) and the window lookup.
  'Win32_Graphics_Gdi',
  'Win32_Storage_Xps',
  'Win32_UI_WindowsAndMessaging',
  // The Windows Graphics Capture of the game window (capture-cascade CAP-01, CAP-04; maintainer exception O1, 2026-11-20).
  // The capture item, one Direct3D 11 device that copies one texture to the CPU, and the window's visible bounds: no
  // feature here reaches process memory, input, hooks or process handles.
  'Graphics', // SizeInt32, the capture item's size
  'Graphics_Capture', // GraphicsCaptureItem, Direct3D11CaptureFramePool, GraphicsCaptureSession
  'Graphics_DirectX', // DirectXPixelFormat of the frame pool (B8G8R8A8)
  'Graphics_DirectX_Direct3D11', // IDirect3DDevice, the WinRT view of the device the frame pool needs
  'Win32_Graphics_Direct3D', // D3D_DRIVER_TYPE_HARDWARE, to create the device
  'Win32_Graphics_Direct3D11', // the device, its context and the staging texture that copies one frame
  'Win32_Graphics_Dxgi', // IDXGIDevice, to make the WinRT device from the D3D device
  'Win32_Graphics_Dxgi_Common', // D3D11_TEXTURE2D_DESC is gated behind it
  'Win32_Graphics_Dwm', // DwmGetWindowAttribute(EXTENDED_FRAME_BOUNDS): where the client sits in the frame
  'Win32_System_WinRT', // RoInitialize, the capture thread's apartment
  'Win32_System_WinRT_Direct3D11', // CreateDirect3D11DeviceFromDXGIDevice, IDirect3DDxgiInterfaceAccess
  'Win32_System_WinRT_Graphics_Capture', // IGraphicsCaptureItemInterop::CreateForWindow, from the game window's handle
  // Assisted typing (FR-28, AST-09): Unicode character keystrokes and the hotkey's own modifier keys, in `typing.rs` alone.
  'Win32_UI_Input_KeyboardAndMouse',
];

// The only five files that may allow unsafe_code, each with the windows:: paths it may name.
const UNSAFE_ADAPTERS = {
  // The Windows Graphics Capture of the game window (capture-cascade O1): the item is made from the game window's own
  // handle, one frame is copied through a staging texture, and the client rectangle is located in the window frame.
  'src/adapters/graphics_capture.rs': [
    'Graphics::Capture',
    'Graphics::DirectX',
    'HMODULE',
    'HWND',
    'POINT',
    'RECT',
    'E_FAIL',
    'D3D_DRIVER_TYPE_HARDWARE',
    'D3D11CreateDevice',
    'D3D11_CPU_ACCESS_READ',
    'D3D11_CREATE_DEVICE_BGRA_SUPPORT',
    'D3D11_MAP_READ',
    'D3D11_MAPPED_SUBRESOURCE',
    'D3D11_SDK_VERSION',
    'D3D11_TEXTURE2D_DESC',
    'D3D11_USAGE_STAGING',
    'ID3D11Device',
    'ID3D11DeviceContext',
    'ID3D11Texture2D',
    'DWMWA_EXTENDED_FRAME_BOUNDS',
    'DwmGetWindowAttribute',
    'IDXGIDevice',
    'ClientToScreen',
    'GetClientRect',
    'CreateDirect3D11DeviceFromDXGIDevice',
    'IDirect3DDxgiInterfaceAccess',
    'IGraphicsCaptureItemInterop',
    'RO_INIT_MULTITHREADED',
    'RoInitialize',
    'core::Interface',
    'core::factory',
    'core::Result',
    'core::Error',
  ],
  'src/adapters/window_capture.rs': [
    'HWND',
    'LPARAM',
    'RECT',
    'BOOL',
    'BI_RGB',
    'BITMAPINFO',
    'BITMAPINFOHEADER',
    'CreateCompatibleBitmap',
    'CreateCompatibleDC',
    'DIB_RGB_COLORS',
    'DeleteDC',
    'DeleteObject',
    'GetDC',
    'GetDIBits',
    'HDC',
    'HGDIOBJ',
    'ReleaseDC',
    'SelectObject',
    'PRINT_WINDOW_FLAGS',
    'PW_CLIENTONLY',
    'PrintWindow',
    'EnumWindows',
    'GetClientRect',
    'GetWindowRect',
    'GetWindowThreadProcessId',
    'IsIconic',
    'IsWindowVisible',
    'PW_RENDERFULLCONTENT',
    // Which window has the focus (assisted typing, AST-03): a read, never an input.
    'GetForegroundWindow',
  ],
  'src/adapters/toolhelp.rs': [
    'CreateToolhelp32Snapshot',
    'Process32FirstW',
    'Process32NextW',
    'CloseHandle',
    'PROCESSENTRY32W',
    'TH32CS_SNAPPROCESS',
    'HANDLE',
  ],
  // The one file that sends input to the game (FR-28, AST-06, ADR 010): Unicode character keystrokes, and a read of the
  // state of the hotkey's own modifier keys. The path list below is all it may name; `typingAdapterViolations` adds the
  // rules on what it may do with them.
  'src/adapters/typing.rs': [
    'INPUT',
    'INPUT_0',
    'INPUT_KEYBOARD',
    'INPUT_TYPE',
    'KEYBDINPUT',
    'KEYBD_EVENT_FLAGS',
    'KEYEVENTF_UNICODE',
    'KEYEVENTF_KEYUP',
    'SendInput',
    'GetAsyncKeyState',
    'VIRTUAL_KEY',
    'VK_CONTROL',
    'VK_SHIFT',
    'VK_MENU',
  ],
  'src/adapters/windows_ocr.rs': [
    'Media::Ocr',
    'Graphics::Imaging',
    'Globalization::Language',
    'Storage::Streams',
  ],
};

// Rust files of the app crate. Build output, generated files and the boundary fixtures are not the app's sources.
const rustFiles = (base) => {
  const crateDir = path.join(base, agentTauri);
  if (!existsSync(crateDir)) return [];
  return readdirSync(crateDir, { recursive: true })
    .map((entry) => entry.split(path.sep).join('/'))
    .filter((rel) => rel.endsWith('.rs'))
    .filter((rel) => !/^(target|gen|boundary-fixtures)\//.test(rel))
    .map((rel) => ({ rel, text: readFileSync(path.join(crateDir, rel), 'utf8') }));
};

const crateFile = (base, rel) => {
  const file = path.join(base, agentTauri, rel);
  return existsSync(file) ? readFileSync(file, 'utf8') : undefined;
};

// Expands `use windows::...::{A, B}` groups and simple `windows::A::B` paths into full paths.
const windowsPathsIn = (text) => {
  const paths = [];
  const simple = text.replace(/windows::(?:([\w:]+?)::)?\{([^}]*)\}/g, (_, prefix, names) => {
    for (const name of names
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)) {
      paths.push(prefix ? `${prefix}::${name}` : name);
    }
    return '';
  });
  for (const match of simple.matchAll(/windows::([\w:]+)/g)) paths.push(match[1].replace(/::$/, ''));
  return paths;
};

const isAllowedWindowsPath = (windowsPath, allowed) =>
  allowed.some(
    (entry) =>
      windowsPath === entry || windowsPath.startsWith(`${entry}::`) || windowsPath.endsWith(`::${entry}`),
  );

// Each rule returns the violations it finds under `base`; an empty list passes.
const windowsFeatureViolations = (base) => {
  const manifest = crateFile(base, 'Cargo.toml') ?? '';
  const violations = [];
  for (const block of manifest.matchAll(/^\s*windows\s*=\s*\{([^}]*)\}/gm)) {
    const features = block[1].match(/features\s*=\s*\[([^\]]*)\]/)?.[1] ?? '';
    for (const feature of features.matchAll(/"([^"]+)"/g)) {
      if (!WINDOWS_FEATURE_ALLOW_LIST.includes(feature[1])) {
        violations.push(`windows feature ${feature[1]} is not on the allow-list`);
      }
    }
  }
  return violations;
};

const unsafeLocationViolations = (base) =>
  rustFiles(base)
    .filter(({ rel, text }) => /allow\(\s*unsafe_code\s*\)/.test(text) && !(rel in UNSAFE_ADAPTERS))
    .map(({ rel }) => `${rel} allows unsafe_code outside the five adapters`);

const adapterPathViolations = (base) =>
  Object.entries(UNSAFE_ADAPTERS).flatMap(([rel, allowed]) => {
    const text = crateFile(base, rel);
    if (text === undefined) return [];
    return windowsPathsIn(text)
      .filter((windowsPath) => !isAllowedWindowsPath(windowsPath, allowed))
      .map((windowsPath) => `${rel} references windows::${windowsPath}, which is not on its allow-list`);
  });

// Assisted typing (AST-06, AST-09; ADR 010). The names that send or read input live in one file, `typing.rs`, and that file
// can do nothing but type Unicode characters and read three modifier keys. The agent never confirms an action in the game.
const TYPING_ADAPTER = 'src/adapters/typing.rs';
const INPUT_NAMES =
  /\b(?:SendInput|GetAsyncKeyState|GetKeyState|GetKeyboardState|SetKeyboardState|SetCursorPos|keybd_event|mouse_event|KeyboardAndMouse|(?:SendMessage|PostMessage|SendNotifyMessage|SendMessageTimeout|PostThreadMessage)[AW]?)\b/;
// What the typing adapter may not name, though it is the one file allowed to send input (AST-09): it calls SendInput and
// GetAsyncKeyState, nothing else of the list above.
const TYPING_BANNED_NAMES =
  /\b(?:GetKeyState|GetKeyboardState|SetKeyboardState|SetCursorPos|keybd_event|mouse_event|(?:SendMessage|PostMessage|SendNotifyMessage|SendMessageTimeout|PostThreadMessage)[AW]?)\b/g;

// Comments out, string-aware: a `//` or `/*` inside a string or char literal hides nothing, and a quote inside a comment
// opens nothing. Newlines are kept so line anchors still work.
const CHAR_LITERAL = /^'(?:\\[^']+|[^\\'])'/;
const withoutComments = (text) => {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    const raw = /^b?r(#*)"/.exec(rest);
    const char = CHAR_LITERAL.exec(rest);
    if (raw) {
      const close = text.indexOf(`"${raw[1]}`, i + raw[0].length);
      const end = close === -1 ? text.length : close + 1 + raw[1].length;
      out += text.slice(i, end);
      i = end;
    } else if (text[i] === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === '\\' ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (char) {
      out += char[0];
      i += char[0].length;
    } else if (rest.startsWith('//')) {
      const eol = text.indexOf('\n', i);
      i = eol === -1 ? text.length : eol;
    } else if (rest.startsWith('/*')) {
      const close = text.indexOf('*/', i + 2);
      const end = close === -1 ? text.length : close + 2;
      out += text.slice(i, end).replace(/[^\n]/g, '');
      i = end;
    } else {
      out += text[i];
      i += 1;
    }
  }
  return out;
};

// The text of a Rust file with exactly its `#[cfg(test)] mod …` blocks removed (braces balanced, strings skipped), so code
// after the test module is still read. `text` must already be without comments.
const withoutTestModules = (text) => {
  const opener = /^[ \t]*#\[cfg\(test\)\]\s*(?:pub(?:\([^)]*\))?\s+)?mod\s+\w+\s*/m;
  let rest = text;
  let out = '';
  for (let match = opener.exec(rest); match; match = opener.exec(rest)) {
    out += rest.slice(0, match.index);
    let i = match.index + match[0].length;
    if (rest[i] === '{') {
      let depth = 0;
      for (; i < rest.length; i += 1) {
        const char = rest[i];
        if (char === '"') {
          i += 1;
          while (i < rest.length && rest[i] !== '"') i += rest[i] === '\\' ? 2 : 1;
        } else if (/^'[{}]'/.test(rest.slice(i, i + 3))) {
          i += 2;
        } else if (char === '{') {
          depth += 1;
        } else if (char === '}') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      i += 1;
    } else {
      i = rest.indexOf(';', i) + 1 || rest.length;
    }
    rest = rest.slice(i);
  }
  return out + rest;
};

const inputOutsideTypingViolations = (base) =>
  rustFiles(base)
    .filter(({ rel }) => rel !== TYPING_ADAPTER)
    .filter(({ text }) => INPUT_NAMES.test(withoutComments(text)))
    .map(({ rel }) => `${rel} names an input function, and only ${TYPING_ADAPTER} may`);

const ALLOWED_VIRTUAL_KEYS = ['VK_CONTROL', 'VK_SHIFT', 'VK_MENU'];

const typingAdapterViolations = (base) => {
  const text = crateFile(base, TYPING_ADAPTER);
  if (text === undefined) return [];
  const code = withoutTestModules(withoutComments(text));
  const violations = [];
  for (const key of new Set(code.match(/\bVK_[A-Z0-9_]+\b/g) ?? [])) {
    if (!ALLOWED_VIRTUAL_KEYS.includes(key)) {
      violations.push(
        `${TYPING_ADAPTER} names ${key}: only Ctrl, Shift and Alt are read, and no key is sent`,
      );
    }
  }
  for (const match of code.matchAll(/\bwVk\s*:\s*([^,}\n]+)/g)) {
    if (!/^VIRTUAL_KEY\(\s*0\s*\)$/.test(match[1].trim())) {
      violations.push(
        `${TYPING_ADAPTER} sets wVk to ${match[1].trim()}: a keystroke must be Unicode, with virtual key 0`,
      );
    }
  }
  for (const name of new Set(code.match(/\bKEYEVENTF_[A-Z_]+\b/g) ?? [])) {
    if (!['KEYEVENTF_UNICODE', 'KEYEVENTF_KEYUP'].includes(name)) {
      violations.push(
        `${TYPING_ADAPTER} uses ${name}: only KEYEVENTF_UNICODE and KEYEVENTF_KEYUP may be set`,
      );
    }
  }
  for (const name of new Set(
    code.match(
      /\b(?:INPUT_MOUSE|INPUT_HARDWARE|MOUSEINPUT|HARDWAREINPUT|MOUSEEVENTF_[A-Z_]+|[A-Za-z]*Clipboard[A-Za-z]*)\b/g,
    ) ?? [],
  )) {
    violations.push(`${TYPING_ADAPTER} uses ${name}: no mouse, hardware or clipboard input`);
  }
  for (const name of new Set(code.match(TYPING_BANNED_NAMES) ?? [])) {
    violations.push(`${TYPING_ADAPTER} names ${name}: it may only call SendInput and GetAsyncKeyState`);
  }
  const constructions = code.match(/\bKEYBDINPUT\s*\{/g) ?? [];
  if (constructions.length !== 1) {
    violations.push(
      `${TYPING_ADAPTER} builds KEYBDINPUT ${constructions.length} times: exactly one construction is allowed`,
    );
  }
  // Each field is pinned to the one real expression, so no other spelling (assignment, shorthand, another struct) passes.
  for (const [field, pinned] of [
    ['wVk', /\bwVk\s*:\s*VIRTUAL_KEY\(\s*0\s*\)\s*,/g],
    ['wScan', /\bwScan\s*:\s*stroke\.unit\s*,/g],
    ['dwFlags', /\bdwFlags\s*:\s*KEYBD_EVENT_FLAGS\(\s*flags\.0\s*\)\s*,/g],
  ]) {
    const named = (code.match(new RegExp(`\\b${field}\\b`, 'g')) ?? []).length;
    const exact = (code.match(pinned) ?? []).length;
    if (named !== 1 || exact !== 1) {
      violations.push(
        `${TYPING_ADAPTER} names ${field} ${named} times, ${exact} as the pinned expression: it appears once, in the keystroke, as the pinned expression`,
      );
    }
  }
  for (const match of code.matchAll(/\bKEYBD_EVENT_FLAGS\s*\(([^)]*)\)/g)) {
    if (match[1].trim() !== 'flags.0') {
      violations.push(
        `${TYPING_ADAPTER} builds KEYBD_EVENT_FLAGS from ${match[1].trim()}: only flags.0 is allowed`,
      );
    }
  }
  if (code.includes('SendInput') && !/\bKEYEVENTF_UNICODE\b/.test(code)) {
    violations.push(`${TYPING_ADAPTER} sends input without KEYEVENTF_UNICODE`);
  }
  return violations;
};

// The scoped `allow` for the input functions that clippy.toml bans sits in the typing adapter alone (AST-09).
const clippyAllowViolations = (base) =>
  rustFiles(base)
    .filter(({ rel }) => rel !== TYPING_ADAPTER)
    .filter(({ text }) => /allow\(\s*clippy::disallowed_methods\s*\)/.test(text))
    .map(({ rel }) => `${rel} allows clippy::disallowed_methods, and only ${TYPING_ADAPTER} may`);

const instrumentViolations = (base) =>
  rustFiles(base).flatMap(({ rel, text }) =>
    [...text.matchAll(/#\[\s*(?:tracing::)?instrument\b([^\]]*)\]/g)]
      .filter((attribute) => !/\bskip_all\b/.test(attribute[1]))
      .map(() => `${rel} has #[instrument] without skip_all`),
  );

// The app crate and the adapters crate each have a `fixture-read` feature (AGS-33, AD-096). Neither may be a default feature.
const FIXTURE_READ_MANIFESTS = ['Cargo.toml', 'adapters/Cargo.toml'];

const fixtureReadViolations = (base) =>
  FIXTURE_READ_MANIFESTS.flatMap((rel) => {
    const manifest = crateFile(base, rel) ?? '';
    const defaults = manifest.match(/^default\s*=\s*\[([^\]]*)\]/m)?.[1] ?? '';
    return /"fixture-read"/.test(defaults) ? [`${rel} enables fixture-read by default`] : [];
  });

// Trust rules (agent-trust, NFR-04, NFR-06). The token, the stream the agent accepts and what it sends are pinned so a
// change that widens one fails here and needs a reviewer's eye.

// Non-test source of a Rust file: the unit tests of a file sit in a `#[cfg(test)]` module at its end, and the crates' own
// `tests/` and `extra-tests/` folders are test code.
// The cut is the `#[cfg(test)]` that opens a module (`mod`), not the first one: a `#[cfg(test)] use` above real code would
// otherwise hide everything below it.
const nonTestText = (text) => text.split(/^#\[cfg\(test\)\]\s*(?:pub(?:\([^)]*\))?\s+)?mod\b/m)[0];
const isTestFile = (rel) => /(^|\/)(tests|extra-tests|examples)\//.test(rel);

// The files that may call `Secret::expose` (AGT-03): the wrapper, the token store, the API client and the relay client.
const EXPOSE_ALLOW_LIST = [
  'core/src/secret.rs',
  'src/adapters/token_store.rs',
  'adapters/src/http/api_client.rs',
  'adapters/src/telemetry/relay_client.rs',
];
const LOG_EVENT = /\b(?:tracing::)?(?:trace|debug|info|warn|error|event)!\s*\(/;
// Macros that print or build text. Beside `expose()` the printing ones are never right; `format!` is right only to build the
// `Bearer` header value, so a `format!` whose own arguments call `expose()` is refused unless it is that one.
const PRINT_MACRO = /\b(?:println|eprintln|dbg)!\s*\(/;

/** The text of every `format!(...)` call, up to its closing parenthesis. */
const formatCalls = (code) =>
  [...code.matchAll(/\bformat!\s*\(/g)].map((match) => {
    let depth = 1;
    let end = match.index + match[0].length;
    while (end < code.length && depth > 0) {
      if (code[end] === '(') depth += 1;
      if (code[end] === ')') depth -= 1;
      end += 1;
    }
    return code.slice(match.index, end);
  });
const BEARER_FORMAT = /^format!\s*\(\s*"Bearer \{\}"\s*,\s*[\w.]+\.expose\(\)\s*\)$/;

const secretExposureViolations = (base) =>
  rustFiles(base)
    .filter(({ rel }) => !isTestFile(rel))
    .flatMap(({ rel, text }) => {
      const code = nonTestText(text);
      if (!/\.expose\s*\(/.test(code) && !/\bexpose\s*\(/.test(code.replace(/pub fn expose/g, ''))) return [];
      if (!EXPOSE_ALLOW_LIST.includes(rel)) return [`${rel} calls expose() and is not on the allow-list`];
      return [
        ...(LOG_EVENT.test(code) ? [`${rel} calls expose() and logs an event`] : []),
        ...(PRINT_MACRO.test(code)
          ? [`${rel} calls expose() and prints with println!, eprintln! or dbg!`]
          : []),
        ...(formatCalls(code).some((call) => /expose\s*\(/.test(call) && !BEARER_FORMAT.test(call))
          ? [`${rel} calls expose() inside a format! that is not the Bearer header`]
          : []),
      ];
    });

// The variants of the two types a stream event turns into (AGT-04). A new variant is a new thing the server can make the
// agent do, so it fails until a reviewer lists it here.
const STREAM_VARIANTS = [
  {
    file: 'core/src/ports.rs',
    type: 'StreamItem',
    variants: ['RoomAssigned', 'ReadyCheckStarted', 'ReadyCheckResolved', 'RoomEnded', 'Ended'],
  },
  {
    file: 'adapters/src/http/sse.rs',
    type: 'StreamEffect',
    variants: ['SetAssignment', 'ReadyCheckStarted', 'ReadyCheckResolved', 'RoomEnded', 'Ignore'],
  },
];

const enumVariants = (text, name) => {
  const body = text.match(new RegExp(`pub enum ${name}\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1];
  if (body === undefined) return undefined;
  return body
    .split('\n')
    .filter((line) => /^ {4}[A-Z]/.test(line))
    .map((line) => line.trim().match(/^[A-Za-z0-9]+/)[0]);
};

const streamVariantViolations = (base) =>
  STREAM_VARIANTS.flatMap(({ file, type, variants }) => {
    const found = enumVariants(crateFile(base, file) ?? '', type);
    if (found === undefined) return [`${file} has no enum ${type}`];
    const extra = found.filter((name) => !variants.includes(name));
    const missing = variants.filter((name) => !found.includes(name));
    return [
      ...extra.map((name) => `${file}: ${type}::${name} is not on the reviewed list`),
      ...missing.map((name) => `${file}: ${type}::${name} is on the list and gone`),
    ];
  });

// What the HTTP adapters may send (AGT-05): contract bodies only. No frame or pixel type, no raw body, no multipart.
const FRAME_TYPES = /\b(?:Rgba|FrameSource|FrameReader|FrameReading|PanelReading)\b/;
const RAW_UPLOAD = /multipart|octet-stream|\bimage\/|\.body\s*\(|Part::/;

// The span exporter's client sends the protobuf batch with one `.body(...)`: the only raw body allowed, in that one file.
const RELAY_CLIENT = 'adapters/src/telemetry/relay_client.rs';
// The chat post (server-name-match) hands the HTTP adapter a name and nothing else: it names no frame type and sends no raw body.
const CHAT_POST = 'core/src/chat_post.rs';
const RAW_BODY = /\.body\s*\(/g;

const outgoingDataViolations = (base) => {
  const files = rustFiles(base).filter(
    ({ rel }) =>
      (rel.startsWith('adapters/src/http/') || rel === RELAY_CLIENT || rel === CHAT_POST) && !isTestFile(rel),
  );
  const manifest = crateFile(base, 'adapters/Cargo.toml') ?? '';
  return [
    ...files.flatMap(({ rel, text }) => {
      const code = nonTestText(text);
      return [
        ...(FRAME_TYPES.test(code) ? [`${rel} names a frame or pixel type`] : []),
        ...((rel === RELAY_CLIENT ? code.replace(RAW_BODY, '') : code).match(RAW_UPLOAD)
          ? [`${rel} sends a raw body, a multipart part or an image`]
          : []),
        ...(rel === RELAY_CLIENT && (code.match(RAW_BODY) ?? []).length > 1
          ? [`${rel} sends more than the one protobuf batch body`]
          : []),
      ];
    }),
    ...(/reqwest[^\n]*multipart/.test(manifest) ? ['adapters/Cargo.toml enables reqwest multipart'] : []),
  ];
};

// The chat post and the HTTP adapters that carry its body put no name in a span, an event or a counter (SNM-04, ADR 036): no
// tracing call of `chat_post.rs` or of `adapters/src/http/**` names the player's name or the observation that holds it. Spans and events carry fixed words only.
const TRACING_CALL =
  /\b(?:tracing::)?(?:info_span|debug_span|trace_span|warn_span|error_span|span|info|debug|trace|warn|error|event)!\s*\(([^;]*?)\)\s*;/gs;
const NAME_IN_TELEMETRY = /\bname\b|\bnames?\(\)|\bobservation\b|\bheld\b|\bevent\s*\.\s*1/;

const chatPostTelemetryViolations = (base) =>
  rustFiles(base)
    .filter(({ rel }) => (rel === CHAT_POST || rel.startsWith('adapters/src/http/')) && !isTestFile(rel))
    .flatMap(({ rel, text }) =>
      [...codeOnly(nonTestText(text)).matchAll(TRACING_CALL)]
        .filter((call) => NAME_IN_TELEMETRY.test(call[1]))
        .map(() => `${rel} puts the name or the observation in a span, an event or a counter`),
    );

// Capture scope (ADR 010, capture-cascade CAP-04): the capture adapters see the game window and nothing else. No monitor, no
// desktop or screen device context, no duplication of the output. The allowed `IGraphicsCaptureItemInterop` and
// `Graphics::Capture` imports reach these through method calls, so the rule matches calls and uses, not import paths.
const CAPTURE_ADAPTERS = ['src/adapters/graphics_capture.rs', 'src/adapters/window_capture.rs'];
const BANNED_CAPTURE_CALLS = [
  'CreateForMonitor',
  'TryCreateFromDisplayId',
  'DuplicateOutput',
  'GetDesktopWindow',
  'GetWindowDC',
  'MonitorFromWindow',
  'BitBlt',
];
// `GetDC(None)`, `GetDC(Some(None))`-style nulls, `GetDC(HWND(0))`, `GetDC(HWND::default())`, `GetDC(null)`: the screen's DC.
const SCREEN_DC =
  /\bGetDC\s*\(\s*(?:Some\s*\(\s*)?(?:None|0\b|(?:std::|core::)?(?:ptr::)?null(?:_mut)?\s*\(\s*\)|HWND\s*\(\s*(?:0\b[^)]*|[\w:]*null(?:_mut)?\s*\(\s*\))\)|HWND::default\s*\(\s*\))/;

// Source text without comments and string literals, so a doc line that names a call is not one.
const codeOnly = (text) =>
  text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '')
    .replace(/"(?:[^"\\]|\\.)*"/g, '""');

// The rule runs over every `.rs` file under `src-tauri` (the app crate's `src/`, `build.rs` and `examples/`, and the adapters,
// core, domain and xtask crates with their `examples/` and `tests/`): a call in any other file would go unseen. Paths stay
// relative to `src-tauri`, so the allowances below name `src/adapters/...` exactly. The
// window-scoped forms (`CreateForWindow`, `GetDC` on a window) are allowed only in the two capture adapters. The OCR engine's
// `TryCreateFromLanguage` is not a capture item and is allowed only in its own adapter.
const OCR_ADAPTER = 'src/adapters/windows_ocr.rs';
const OCR_CONSTRUCTORS = ['TryCreateFromLanguage', 'TryCreateFromUserProfileLanguages'];
// Screen device contexts by name: `GetDCEx` and `CreateDCW` reach the screen or any display, whatever their arguments.
const SCREEN_DC_BY_NAME = ['GetDCEx', 'CreateDCW', 'CreateDCA'];

const captureScopeViolations = (base) =>
  rustFiles(base).flatMap(({ rel, text }) => {
    const inAdapter = CAPTURE_ADAPTERS.includes(rel);
    const code = codeOnly(text);
    return [
      ...[...BANNED_CAPTURE_CALLS, ...SCREEN_DC_BY_NAME]
        .filter((name) => new RegExp(`\\b${name}\\b`).test(code))
        .map((name) => `${rel} uses ${name}, which reaches beyond the game window`),
      ...(SCREEN_DC.test(code) ? [`${rel} calls GetDC on the screen, not on the game window`] : []),
      ...(!inAdapter && /\bGetDC\b/.test(code)
        ? [`${rel} calls GetDC outside the two capture adapters`]
        : []),
      ...[...code.matchAll(/\b(CreateFor\w+|TryCreateFrom\w+)\b/g)]
        .map((match) => match[1])
        .filter((name) => !(OCR_CONSTRUCTORS.includes(name) && rel === OCR_ADAPTER))
        .filter((name) => !(name === 'CreateForWindow' && inAdapter))
        .filter((name, index, all) => all.indexOf(name) === index)
        .map((name) =>
          name === 'CreateForWindow'
            ? `${rel} uses CreateForWindow outside the two capture adapters`
            : `${rel} uses ${name}; CreateForWindow is the only capture item constructor`,
        ),
    ];
  });

const fixtureBase = (name) => path.join(root, 'scripts/test/fixtures/agent-rules', name);

test('windows features stay on the allow-list', () => {
  assert.deepEqual(windowsFeatureViolations(root), []);
});

test('unsafe is allowed only in the five adapters', () => {
  assert.deepEqual(unsafeLocationViolations(root), []);
});

test('unsafe adapters reference only allowed windows paths', () => {
  assert.deepEqual(adapterPathViolations(root), []);
});

test('instrument always skips arguments', () => {
  assert.deepEqual(instrumentViolations(root), []);
});

test('fixture-read is never a default feature in either manifest', () => {
  assert.deepEqual(fixtureReadViolations(root), []);
});

test('cargo tree for the app crate holds no fixture-read', () => {
  const bundled = path.join(homedir(), '.cargo', 'bin', 'cargo');
  const cargo = existsSync(bundled) ? bundled : 'cargo';
  const tree = spawnSync(
    cargo,
    [
      'tree',
      '--locked',
      '--manifest-path',
      path.join(root, agentTauri, 'Cargo.toml'),
      '-p',
      'd2rmm-agent',
      '-e',
      'features',
    ],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  assert.equal(tree.status, 0, `cargo tree failed: ${tree.stderr}`);
  assert.doesNotMatch(tree.stdout, /fixture-read/);
});

test('release-agent.yml builds no example and enables no all-features', () => {
  const workflow = readText('.github/workflows/release-agent.yml');
  for (const flag of ['--examples', '--all-targets', '--all-features']) {
    assert.ok(!workflow.includes(flag), `release-agent.yml must not pass ${flag}`);
  }
});

test('only the typing adapter names an input function or allows the clippy ban on them', () => {
  assert.deepEqual(inputOutsideTypingViolations(root), []);
  assert.deepEqual(clippyAllowViolations(root), []);
});

test('the typing adapter types Unicode characters and reads three modifier keys, and nothing else', () => {
  assert.deepEqual(typingAdapterViolations(root), []);
});

test('the input rule rejects an input function outside the typing adapter and a clippy allow outside it', () => {
  assert.match(
    inputOutsideTypingViolations(fixtureBase('input-outside-typing')).join('\n'),
    /src\/adapters\/window_capture\.rs names an input function, and only src\/adapters\/typing\.rs may/,
  );
  assert.match(
    clippyAllowViolations(fixtureBase('input-outside-typing')).join('\n'),
    /src\/adapters\/window_capture\.rs allows clippy::disallowed_methods/,
  );
});

test('the typing adapter rule rejects a confirming or navigating key', () => {
  const violations = typingAdapterViolations(fixtureBase('typing-confirm-key')).join('\n');
  for (const key of ['VK_RETURN', 'VK_TAB', 'VK_SPACE', 'VK_ESCAPE', 'VK_BACK']) {
    assert.match(violations, new RegExp(`names ${key}`), key);
  }
});

test('the typing adapter rule reads code after the test module and skips only the module itself', () => {
  const violations = typingAdapterViolations(fixtureBase('typing-after-test-module')).join('\n');
  assert.match(violations, /names VK_RETURN/);
  assert.doesNotMatch(violations, /VK_F1/);
});

test('the typing adapter rule rejects a virtual key in a keystroke and a scan-code or extended-key flag', () => {
  const violations = typingAdapterViolations(fixtureBase('typing-virtual-key')).join('\n');
  assert.match(violations, /sets wVk to VIRTUAL_KEY\(13\)/);
  assert.match(violations, /sets wVk to VIRTUAL_KEY\(vk\)/);
  assert.match(violations, /uses KEYEVENTF_SCANCODE/);
  assert.match(violations, /uses KEYEVENTF_EXTENDEDKEY/);
});

test('the typing adapter rule pins each KEYBDINPUT field to the one keystroke expression', () => {
  const assigned = typingAdapterViolations(fixtureBase('typing-field-assign')).join('\n');
  assert.match(assigned, /builds KEYBDINPUT 2 times/);
  assert.match(assigned, /names wVk 3 times, 2 as the pinned expression/);
  assert.match(assigned, /names wScan 3 times, 2 as the pinned expression/);
  const shorthand = typingAdapterViolations(fixtureBase('typing-field-shorthand')).join('\n');
  for (const field of ['wVk', 'wScan', 'dwFlags']) {
    assert.match(shorthand, new RegExp(`names ${field} 2 times, 0 as the pinned expression`), field);
  }
});

test('the typing adapter rule accepts KEYBD_EVENT_FLAGS only over flags.0', () => {
  const violations = typingAdapterViolations(fixtureBase('typing-flags-expression')).join('\n');
  assert.match(violations, /builds KEYBD_EVENT_FLAGS from 0x0008/);
  assert.match(violations, /builds KEYBD_EVENT_FLAGS from flags\.0 \| 0x0001/);
  assert.match(violations, /builds KEYBD_EVENT_FLAGS from 0x0004/);
});

test('a double slash inside a string literal hides no code from the typing rules', () => {
  const violations = typingAdapterViolations(fixtureBase('typing-string-slashes')).join('\n');
  assert.match(violations, /names VK_RETURN/);
  assert.match(violations, /names VK_TAB/);
  assert.doesNotMatch(violations, /VK_ESCAPE/);
  assert.equal(
    withoutComments('let a = "x // y"; // z\nlet b = 1; /* c */').trim(),
    'let a = "x // y"; \nlet b = 1;',
  );
});

test('every other way to send input or move the cursor is an input name, and the typing adapter names none', () => {
  const names = [
    'SendMessageA',
    'SendMessageW',
    'PostMessageA',
    'PostMessageW',
    'SendNotifyMessageA',
    'SendNotifyMessageW',
    'SendMessageTimeoutA',
    'SendMessageTimeoutW',
    'PostThreadMessageA',
    'PostThreadMessageW',
    'SetCursorPos',
    'SetKeyboardState',
    'keybd_event',
    'mouse_event',
  ];
  for (const name of names) {
    assert.ok(INPUT_NAMES.test(`let _ = ${name};`), `${name} is an input name`);
  }
  assert.match(
    inputOutsideTypingViolations(fixtureBase('input-outside-typing-variants')).join('\n'),
    /window_capture\.rs names an input function/,
  );
  const violations = typingAdapterViolations(fixtureBase('typing-other-input')).join('\n');
  for (const name of [...names, 'GetKeyState', 'GetKeyboardState']) {
    assert.match(violations, new RegExp(`names ${name}:`), name);
  }
});

test('the typing adapter rule rejects mouse, hardware and clipboard input and a send without Unicode', () => {
  const violations = typingAdapterViolations(fixtureBase('typing-mouse-clipboard')).join('\n');
  for (const name of [
    'INPUT_MOUSE',
    'MOUSEINPUT',
    'MOUSEEVENTF_LEFTDOWN',
    'INPUT_HARDWARE',
    'SetClipboardData',
  ]) {
    assert.match(violations, new RegExp(`uses ${name}`), name);
  }
  assert.match(violations, /sends input without KEYEVENTF_UNICODE/);
});

test('the windows feature rule rejects a feature off the list', () => {
  assert.match(
    windowsFeatureViolations(fixtureBase('windows-feature')).join('\n'),
    /windows feature Win32_System_Diagnostics_Debug is not on the allow-list/,
  );
});

test('the unsafe location rule rejects an allow outside the adapters', () => {
  assert.match(
    unsafeLocationViolations(fixtureBase('unsafe-outside-adapters')).join('\n'),
    /src\/adapters\/http\.rs allows unsafe_code outside the five adapters/,
  );
});

test('the adapter path rule rejects a windows path off the list', () => {
  assert.match(
    adapterPathViolations(fixtureBase('adapter-path')).join('\n'),
    /references windows::Win32::System::Threading::OpenProcess, which is not on its allow-list/,
  );
});

test('the window capture rule rejects input, hook and blit calls', () => {
  const violations = adapterPathViolations(fixtureBase('window-capture-ffi')).join('\n');
  for (const name of ['PostMessageW', 'SendMessageW', 'SetWindowsHookExW', 'BitBlt', 'GetPixel']) {
    assert.match(
      violations,
      new RegExp(`references windows::Win32::[\\w:]+::${name}, which is not on its allow-list`),
      `${name} must fail the window capture allow-list`,
    );
  }
});

test('the capture adapters reach no monitor, no desktop DC and no constructor but CreateForWindow', () => {
  assert.deepEqual(captureScopeViolations(root), []);
});

test('the capture scope rule rejects every monitor and desktop call (ADR 010, CAP-04)', () => {
  for (const name of BANNED_CAPTURE_CALLS) {
    assert.match(
      captureScopeViolations(fixtureBase(`capture-scope-${name}`)).join('\n'),
      new RegExp(`graphics_capture\\.rs uses ${name}, which reaches beyond the game window`),
      `${name} must fail the capture scope rule`,
    );
  }
});

test('the capture scope rule rejects a screen device context and any other item constructor (CAP-04)', () => {
  for (const fixture of ['capture-scope-GetDC-None', 'capture-scope-GetDC-HWND0']) {
    assert.match(
      captureScopeViolations(fixtureBase(fixture)).join('\n'),
      /window_capture\.rs calls GetDC on the screen, not on the game window/,
      fixture,
    );
  }
  assert.match(
    captureScopeViolations(fixtureBase('capture-scope-CreateForOther')).join('\n'),
    /graphics_capture\.rs uses CreateForSomething; CreateForWindow is the only capture item constructor/,
  );
});

test('the capture scope rule runs over every app-crate file, not only the two adapters (CAP-04)', () => {
  const violations = captureScopeViolations(fixtureBase('capture-scope-other-file')).join('\n');
  assert.match(
    violations,
    /src\/other\.rs uses TryCreateFromDisplayId, which reaches beyond the game window/,
  );
  assert.match(violations, /src\/other\.rs uses GetDCEx, which reaches beyond the game window/);
  assert.match(violations, /src\/other\.rs calls GetDC outside the two capture adapters/);
  assert.match(violations, /src\/other\.rs uses CreateForWindow outside the two capture adapters/);
});

test('the capture scope rule also scans build scripts and the other agent crates (CAP-04)', () => {
  const violations = captureScopeViolations(fixtureBase('capture-scope-other-crates')).join('\n');
  assert.match(violations, /^build\.rs uses GetDCEx, which reaches beyond the game window$/m);
  assert.match(violations, /^core\/src\/x\.rs uses GetDCEx, which reaches beyond the game window$/m);
});

test('the capture scope rule accepts CreateForWindow and GetDC on the game window (CAP-04)', () => {
  assert.deepEqual(captureScopeViolations(fixtureBase('capture-scope-accepted')), []);
});

test('only the wrapper, the token store and the two clients call expose, and none logs an event', () => {
  assert.deepEqual(secretExposureViolations(root), []);
});

test('the expose rule rejects a call outside the allow-list', () => {
  assert.match(
    secretExposureViolations(fixtureBase('expose-outside')).join('\n'),
    /core\/src\/leak\.rs calls expose\(\) and is not on the allow-list/,
  );
});

test('the expose rule rejects a log event beside a call on the allow-list', () => {
  assert.match(
    secretExposureViolations(fixtureBase('expose-logged')).join('\n'),
    /adapters\/src\/http\/api_client\.rs calls expose\(\) and logs an event/,
  );
});

test('a stream event turns into one of the reviewed data variants only', () => {
  assert.deepEqual(streamVariantViolations(root), []);
});

test('the stream variant rule rejects a new variant', () => {
  assert.match(
    streamVariantViolations(fixtureBase('stream-new-variant')).join('\n'),
    /StreamItem::RunCommand is not on the reviewed list/,
  );
});

test('the HTTP adapters send contract bodies only: no frame, no raw body, no multipart', () => {
  assert.deepEqual(outgoingDataViolations(root), []);
});

test('the chat post names no frame type, sends no raw body and puts no name in telemetry', () => {
  assert.deepEqual(outgoingDataViolations(root), []);
  assert.deepEqual(chatPostTelemetryViolations(root), []);
});

test('the chat post rules reject a frame type, a raw body and a name in a span or an event', () => {
  const base = fixtureBase('chat-post-leak');
  const violations = outgoingDataViolations(base).join('\n');
  assert.match(violations, /core\/src\/chat_post\.rs names a frame or pixel type/);
  assert.match(violations, /core\/src\/chat_post\.rs sends a raw body, a multipart part or an image/);
  const telemetry = chatPostTelemetryViolations(base);
  assert.equal(telemetry.length, 3, telemetry.join('\n'));
  assert.match(telemetry.join('\n'), /core\/src\/chat_post\.rs puts the name or the observation in a span/);
});

test('the name-in-telemetry rule also rejects a name in a span or an event of the HTTP adapters', () => {
  const telemetry = chatPostTelemetryViolations(fixtureBase('adapters-http-leak'));
  assert.equal(telemetry.length, 2, telemetry.join('\n'));
  assert.match(
    telemetry.join('\n'),
    /adapters\/src\/http\/leak\.rs puts the name or the observation in a span/,
  );
});

test('the outgoing data rule rejects a frame type and a raw body', () => {
  const violations = outgoingDataViolations(fixtureBase('outgoing-frame')).join('\n');
  assert.match(violations, /names a frame or pixel type/);
  assert.match(violations, /sends a raw body, a multipart part or an image/);
});

test('the expose rule rejects a print macro and a format! that is not the Bearer header', () => {
  for (const [fixture, message] of [
    ['expose-println', /calls expose\(\) and prints/],
    ['expose-eprintln', /calls expose\(\) and prints/],
    ['expose-dbg', /calls expose\(\) and prints/],
    ['expose-format', /inside a format! that is not the Bearer header/],
  ]) {
    assert.match(secretExposureViolations(fixtureBase(fixture)).join('\n'), message, fixture);
  }
});

test('the test-module cut starts at a module, so an early cfg(test) use hides nothing', () => {
  assert.match(
    secretExposureViolations(fixtureBase('expose-after-cfg-use')).join('\n'),
    /core\/src\/early\.rs calls expose\(\) and is not on the allow-list/,
  );
  assert.equal(nonTestText('fn a() {}\n#[cfg(test)]\nmod tests {\n fn b() {}\n}\n').includes('fn b'), false);
  assert.equal(nonTestText('#[cfg(test)]\nuse x::y;\nfn real() {}\n').includes('fn real'), true);
});

test('the outgoing data rule covers the span exporter client too', () => {
  const violations = outgoingDataViolations(fixtureBase('outgoing-relay')).join('\n');
  assert.match(violations, /relay_client\.rs names a frame or pixel type/);
  assert.match(violations, /relay_client\.rs sends more than the one protobuf batch body/);
  assert.match(violations, /relay_client\.rs sends a raw body, a multipart part or an image/);
});

test('the instrument rule rejects arguments without skip_all', () => {
  assert.match(
    instrumentViolations(fixtureBase('instrument-without-skip')).join('\n'),
    /src\/app\.rs has #\[instrument\] without skip_all/,
  );
});

test('the fixture-read rule rejects a default feature', () => {
  assert.match(
    fixtureReadViolations(fixtureBase('fixture-read-default')).join('\n'),
    /Cargo\.toml enables fixture-read by default/,
  );
});

test('the fixture-read rule rejects a default feature in the adapters manifest', () => {
  assert.match(
    fixtureReadViolations(fixtureBase('fixture-read-default-adapters')).join('\n'),
    /adapters\/Cargo\.toml enables fixture-read by default/,
  );
});

test('the AGS-01 rule rejects a [features] table in core', () => {
  const manifest = readText(
    'scripts/test/fixtures/agent-rules/core-features-table/apps/agent/src-tauri/core/Cargo.toml',
  );
  assert.match(manifest, CORE_FEATURES_TABLE);
});

test('the AGS-01 rule rejects an optional dependency in core', () => {
  const manifest = readText(
    'scripts/test/fixtures/agent-rules/core-optional-dependency/apps/agent/src-tauri/core/Cargo.toml',
  );
  assert.match(manifest, OPTIONAL_DEPENDENCY);
  assert.doesNotMatch(manifest, CORE_FEATURES_TABLE, 'this fixture is rejected by the optional rule alone');
});

test('the app registers the updater plugin whenever the updater adapter uses it', () => {
  const adapter = crateFile(root, 'src/adapters/updater.rs') ?? '';
  const app = crateFile(root, 'src/app.rs') ?? '';
  if (!adapter.includes('UpdaterExt')) return;
  assert.match(
    app,
    /tauri_plugin_updater::Builder/,
    'the updater adapter calls app.updater(), which needs the plugin registered on the builder',
  );
});

test('the AGS-01 rule accepts dependency feature lists', () => {
  const manifest = readText(`${agentTauri}/core/Cargo.toml`);
  assert.match(manifest, /features\s*=/, 'core lists features on its dependencies, which AGS-01 allows');
  assert.doesNotMatch(manifest, CORE_FEATURES_TABLE);
  assert.doesNotMatch(manifest, OPTIONAL_DEPENDENCY);
});

test('tauri.conf.json keeps the hardened shell', () => {
  const conf = readJson(`${agentTauri}/tauri.conf.json`);
  assert.equal(
    conf.version,
    '../package.json',
    'the version has one source, apps/agent/package.json (AGS-04)',
  );
  assert.equal(conf.build.frontendDist, '../dist');
  assert.equal(conf.build.beforeBuildCommand, '', 'no command runs before the build (release supply chain)');
  assert.equal(conf.build.features, undefined, 'the app enables no build features in the config');
  assert.equal(conf.app.withGlobalTauri, false);
  assert.equal(conf.app.security.csp, CSP);
  assert.deepEqual(
    conf.app.windows.map((window) => window.label),
    ['main'],
    'one window, labelled main',
  );
});

test('the window gets exactly listen, unlisten, get_new_code, get_consent, set_consent and set_hotkey', () => {
  const capability = readJson(`${agentTauri}/capabilities/main.json`);
  assert.deepEqual(capability.windows, ['main']);
  assert.deepEqual(
    [...capability.permissions].sort(),
    [
      'allow-get-consent',
      'allow-get-new-code',
      'allow-set-consent',
      // Assisted typing (AST-09): the window saves the player's hotkey choice; the command types nothing.
      'allow-set-hotkey',
      'core:event:allow-listen',
      'core:event:allow-unlisten',
    ],
    'no updater, shell, fs or http permission reaches the window',
  );
});

// The IPC permissions: a command the window calls needs a handler, a manifest entry and an allow-* permission, or Tauri 2
// refuses the call at run time (the capture consent button failed that way). Pure functions, checked on the sources.
const kebab = (name) => name.replaceAll('_', '-');

export function handlerCommands(appRs) {
  const body = /generate_handler!\s*\[([^\]]*)\]/.exec(appRs)?.[1] ?? '';
  return body
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean)
    .sort();
}

export function manifestCommands(buildRs) {
  const body = /\.commands\(\s*&\[([^\]]*)\]/.exec(buildRs)?.[1] ?? '';
  return [...body.matchAll(/"([^"]+)"/g)].map((match) => match[1]).sort();
}

export function uiCommands(sources) {
  const found = new Set();
  for (const source of sources) {
    for (const match of source.matchAll(/_COMMAND\s*=\s*'([a-z0-9_]+)'/g)) found.add(match[1]);
    for (const match of source.matchAll(/\binvoke(?:<[^>]*>)?\(\s*'([a-z0-9_]+)'/g)) found.add(match[1]);
  }
  return [...found].sort();
}

export function commandPermissionProblems({ handlers, manifest, permissions, ui }) {
  const problems = [];
  const allowed = permissions.filter((name) => name.startsWith('allow-'));
  for (const command of handlers) {
    if (!manifest.includes(command))
      problems.push(`${command} is a handler but not in the app manifest (build.rs)`);
    if (!allowed.includes(`allow-${kebab(command)}`))
      problems.push(`${command} is a handler but allow-${kebab(command)} is not in capabilities/main.json`);
  }
  for (const command of manifest)
    if (!handlers.includes(command)) problems.push(`${command} is in the app manifest but not a handler`);
  for (const permission of allowed)
    if (!handlers.some((command) => permission === `allow-${kebab(command)}`))
      problems.push(`${permission} is allowed but no handler matches it`);
  for (const command of ui)
    if (!handlers.includes(command))
      problems.push(`the UI invokes ${command}, which is not a registered handler`);
  return problems;
}

const uiSourceFiles = (dir) =>
  readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((entry) => {
    const relative = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return uiSourceFiles(relative);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [relative] : [];
  });

test('every window command has a handler, a manifest entry and an IPC permission', () => {
  const capability = readJson(`${agentTauri}/capabilities/main.json`);
  const input = {
    handlers: handlerCommands(readText(`${agentTauri}/src/app.rs`)),
    manifest: manifestCommands(readText(`${agentTauri}/build.rs`)),
    permissions: capability.permissions,
    ui: uiCommands(uiSourceFiles('apps/agent/src').map(readText)),
  };
  assert.ok(input.handlers.length >= 3, 'the handler list is read');
  assert.ok(input.ui.length >= 3, 'the UI commands are read');
  assert.deepEqual(commandPermissionProblems(input), []);
});

test('the command permission check rejects a handler without manifest entry or permission', () => {
  const problems = commandPermissionProblems({
    handlers: ['get_consent', 'get_new_code', 'set_consent'],
    manifest: ['get_new_code'],
    permissions: ['allow-get-new-code', 'allow-stale', 'core:event:allow-listen'],
    ui: ['get_consent', 'unknown_command'],
  });
  assert.equal(problems.length, 6, problems.join('\n'));
});

// AGS-01: core declares no Cargo features. A `features = [...]` list on a dependency is not a feature of core; a
// `[features]` table or an `optional = true` dependency (an implicit feature) is.
const CORE_FEATURES_TABLE = /^\s*\[features\]/m;
const OPTIONAL_DEPENDENCY = /\boptional\s*=\s*true\b/;

test('core has no tauri dependency', () => {
  const manifest = readText(`${agentTauri}/core/Cargo.toml`);
  assert.doesNotMatch(manifest, /^\s*tauri[\w-]*\s*[=.]/m, 'core/Cargo.toml names no tauri crate');
  assert.doesNotMatch(manifest, CORE_FEATURES_TABLE, 'core/Cargo.toml has no [features] table (AGS-01)');
  assert.doesNotMatch(
    manifest,
    OPTIONAL_DEPENDENCY,
    'core/Cargo.toml has no optional dependency, an implicit feature (AGS-01)',
  );
  for (const file of ['core/src/lib.rs']) {
    assert.doesNotMatch(readText(`${agentTauri}/${file}`), /\btauri\b/, `${file} does not use tauri`);
  }
});

const UPDATER_ENDPOINT =
  'https://github.com/pedromoraisf/d2rmatchmaking/releases/latest/download/latest.json';
const UPDATER_PUBKEY_PENDING = 'MAINTAINER_PUBKEY_PENDING';

test('the bundle names an .ico icon that exists, which the Windows installers require', () => {
  const { icon } = readJson(`${agentTauri}/tauri.conf.json`).bundle;
  const ico = icon.find((file) => file.endsWith('.ico'));
  assert.ok(ico, 'bundle.icon lists an .ico file');
  assert.ok(existsSync(path.join(root, agentTauri, ico)), `${ico} exists`);
});

test('updater checks the latest release over https, with no insecure transport', () => {
  const conf = readJson(`${agentTauri}/tauri.conf.json`);
  assert.deepEqual(
    conf.plugins.updater.endpoints,
    [UPDATER_ENDPOINT],
    'the endpoint is the latest release (AD-049)',
  );
  assert.equal(
    conf.plugins.updater.dangerousInsecureTransportProtocol,
    undefined,
    'no insecure transport for the updater (AGS-24)',
  );
  assert.equal(
    conf.bundle.createUpdaterArtifacts,
    true,
    'the updater artifacts are signed at release (AGS-24)',
  );
});

test('updater checks the latest release with the embedded key', () => {
  const pubkey = readJson(`${agentTauri}/tauri.conf.json`).plugins.updater.pubkey;
  assert.notEqual(pubkey, UPDATER_PUBKEY_PENDING, 'the maintainer public key replaces the placeholder');
  assert.match(pubkey, /^[A-Za-z0-9+/=]{20,}$/, 'the public key is base64');
});

// AGS-21 / design.md § Mutation scope: cargo-mutants examines the domain and the migrated rule modules and nothing else.
test('mutation covers the core rule modules', () => {
  const toml = readText(`${agentTauri}/.cargo/mutants.toml`);
  const globs = toml.match(/examine_globs\s*=\s*\[([^\]]*)\]/);
  assert.ok(globs, 'mutants.toml declares examine_globs');
  const scoped = [...globs[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]).sort();
  assert.deepEqual(scoped, [
    'adapters/src/http/sse.rs',
    'adapters/src/http/translate.rs',
    'adapters/src/telemetry/queue.rs',
    'adapters/src/telemetry/relay_client.rs',
    'adapters/src/telemetry/sanitize.rs',
    'core/src/automap_name.rs',
    'core/src/beat.rs',
    'core/src/chat_step.rs',
    'core/src/check_update.rs',
    'core/src/follow_stream.rs',
    'core/src/pair.rs',
    'core/src/party.rs',
    'core/src/post_observation.rs',
    'core/src/screen_reader.rs',
    'domain/src/**/*.rs',
  ]);
});

// The read-only boundary's ban lists (design.md § Read-only boundary; ADR 010; NFR-04). Every name below is required: a
// config without it fails. The lists may grow; they may not shrink.
const REQUIRED_BANNED_CRATES = [
  'sysinfo',
  'process-memory',
  'read-process-memory',
  'proc-maps',
  'memprocfs',
  'ntapi',
  'dll-syringe',
  'retour',
  'detour',
  'minhook',
  'enigo',
  'rdev',
  'inputbot',
  'device_query',
  'willhook',
  'rustautogui',
  'autopilot',
  'mouse-rs',
  'pcap',
  'pnet',
  'windivert',
  'winapi',
  'tauri-plugin-shell',
  'tauri-plugin-fs',
  'tauri-plugin-http',
  'tauri-plugin-global-shortcut',
];
const REQUIRED_DISALLOWED_TYPES = ['std::process::Command', 'tokio::process::Command'];
const REQUIRED_DISALLOWED_METHODS = [
  'windows::Win32::System::Diagnostics::ToolHelp::Toolhelp32ReadProcessMemory',
  'windows::Win32::System::Threading::OpenProcess',
  'windows::Win32::System::Diagnostics::Debug::ReadProcessMemory',
  'windows::Win32::System::Diagnostics::Debug::WriteProcessMemory',
  'windows::Win32::UI::Input::KeyboardAndMouse::SendInput',
  'windows::Win32::UI::Input::KeyboardAndMouse::GetAsyncKeyState',
  // Input to other windows and screen-hook calls the capture never needs (ADR 010, AGS-20).
  'windows::Win32::UI::WindowsAndMessaging::PostMessageW',
  'windows::Win32::UI::WindowsAndMessaging::SendMessageW',
  'windows::Win32::UI::WindowsAndMessaging::SetWindowsHookExW',
  'windows::Win32::UI::WindowsAndMessaging::SetWindowsHookExA',
  'windows::Win32::UI::Accessibility::SetWinEventHook',
  'windows::Win32::Graphics::Gdi::BitBlt',
  'windows::Win32::Graphics::Gdi::StretchBlt',
  'windows::Win32::Graphics::Gdi::GetPixel',
  'windows::Win32::Graphics::Gdi::GetWindowDC',
  'reqwest::ClientBuilder::danger_accept_invalid_certs',
  'reqwest::ClientBuilder::danger_accept_invalid_hostnames',
];

// The body of one `key = [ … ]` list, from its header to the line that closes it.
const listBody = (text, header) => {
  const start = text.indexOf(header);
  if (start < 0) return '';
  return text.slice(start, text.indexOf('\n]', start));
};

const namesIn = (body, pattern) => new Set([...body.matchAll(pattern)].map((match) => match[1]));

const DENY_CRATE = /\{\s*crate\s*=\s*"([^"]+)"/g;
const CLIPPY_PATH = /\{\s*path\s*=\s*"([^"]+)"/g;

const bannedCrateViolations = (deny) => {
  const found = namesIn(listBody(deny, 'deny = ['), DENY_CRATE);
  const missing = REQUIRED_BANNED_CRATES.filter((crate) => !found.has(crate));
  const wildcards = /^wildcards\s*=\s*"deny"/m.test(deny) ? [] : ['deny.toml does not deny wildcards'];
  return [...missing.map((crate) => `deny.toml does not ban crate ${crate}`), ...wildcards];
};

const clippyViolations = (clippy) => {
  const types = namesIn(listBody(clippy, 'disallowed-types = ['), CLIPPY_PATH);
  const methods = namesIn(listBody(clippy, 'disallowed-methods = ['), CLIPPY_PATH);
  return [
    ...REQUIRED_DISALLOWED_TYPES.filter((path) => !types.has(path)).map(
      (path) => `clippy.toml does not disallow type ${path}`,
    ),
    ...REQUIRED_DISALLOWED_METHODS.filter((path) => !methods.has(path)).map(
      (path) => `clippy.toml does not disallow method ${path}`,
    ),
  ];
};

// The config with every line that names `needle` removed: one entry taken out, nothing else changed.
const without = (text, needle) =>
  text
    .split('\n')
    .filter((line) => !line.includes(needle))
    .join('\n');

test('deny.toml bans every crate of the read-only boundary', () => {
  assert.deepEqual(bannedCrateViolations(readText(`${agentTauri}/deny.toml`)), []);
});

test('removing any banned crate from deny.toml fails', () => {
  const deny = readText(`${agentTauri}/deny.toml`);
  for (const crate of REQUIRED_BANNED_CRATES) {
    assert.deepEqual(
      bannedCrateViolations(without(deny, `crate = "${crate}"`)),
      [`deny.toml does not ban crate ${crate}`],
      `removing ${crate} must fail`,
    );
  }
  assert.deepEqual(bannedCrateViolations(deny.replace('wildcards = "deny"', 'wildcards = "allow"')), [
    'deny.toml does not deny wildcards',
  ]);
});

// Clippy reads only the nearest clippy.toml, so every agent config repeats the boundary list (AGS-22, AHM-04).
const AGENT_CLIPPY_FILES = [
  `${agentTauri}/clippy.toml`,
  `${agentTauri}/domain/clippy.toml`,
  `${agentTauri}/boundary-fixtures/domain-clock/clippy.toml`,
];

test('every agent clippy.toml disallows every boundary type and method', () => {
  for (const file of AGENT_CLIPPY_FILES) {
    assert.deepEqual(clippyViolations(readText(file)), [], `${file} must disallow the whole boundary list`);
  }
});

test('removing any disallowed type or method from clippy.toml fails', () => {
  const clippy = readText(`${agentTauri}/clippy.toml`);
  for (const path of REQUIRED_DISALLOWED_TYPES) {
    assert.deepEqual(
      clippyViolations(without(clippy, `path = "${path}"`)),
      [`clippy.toml does not disallow type ${path}`],
      `removing ${path} must fail`,
    );
  }
  for (const path of REQUIRED_DISALLOWED_METHODS) {
    assert.deepEqual(
      clippyViolations(without(clippy, `path = "${path}"`)),
      [`clippy.toml does not disallow method ${path}`],
      `removing ${path} must fail`,
    );
  }
});
