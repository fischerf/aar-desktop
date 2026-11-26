// Operating system the widget runs on ("windows" | "linux" | …), asked once
// from Rust at start-up. Texts and features differ: desktop control and
// dictation (Win+H) exist only on Windows.
//
// `<html data-os="…">` lets CSS hide parts that do not apply
// (`.win-only`, `.linux-only`).

import { invoke } from "@tauri-apps/api/core";

export type Os = "windows" | "linux" | "macos";

let os: Os = "windows";

export function platform(): Os {
  return os;
}

export const isWindows = () => os === "windows";

export async function loadPlatform(): Promise<Os> {
  os = await invoke<Os>("app_platform").catch(() => "windows" as Os);
  document.documentElement.dataset.os = os;
  return os;
}
