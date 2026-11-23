// Aar mascot: a small eaglet ("Aar" is an old German word for eagle), drawn as
// inline SVG. Moods are pure CSS classes on the root element (see styles.css).

import { strings } from "./i18n";

export type Mood =
  | "idle"
  | "listening"
  | "thinking"
  | "talking"
  | "working"
  | "asking"
  | "happy"
  | "error"
  | "sleeping"
  | "offline";

const moodText = strings<Mood>({
  de: {
    idle: "bereit",
    listening: "hört zu",
    thinking: "denkt nach",
    talking: "antwortet",
    working: "arbeitet",
    asking: "braucht deine Erlaubnis",
    happy: "fertig",
    error: "Problem",
    sleeping: "schläft",
    offline: "nicht verbunden",
  },
  en: {
    idle: "ready",
    listening: "listening",
    thinking: "thinking",
    talking: "answering",
    working: "working",
    asking: "needs your permission",
    happy: "done",
    error: "problem",
    sleeping: "sleeping",
    offline: "not connected",
  },
  zh: {
    idle: "就绪",
    listening: "正在听",
    thinking: "正在思考",
    talking: "正在回答",
    working: "正在工作",
    asking: "需要你的许可",
    happy: "完成",
    error: "出问题了",
    sleeping: "休息中",
    offline: "未连接",
  },
});

/** Status text for a mood in the current UI language. */
export function moodLabel(m: Mood): string {
  return moodText(m);
}

const SVG = /* svg */ `
<svg class="mascot-svg" viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="m-body" x1="0" y1="0" x2="0.6" y2="1">
      <stop offset="0%" stop-color="#fcd34d"/>
      <stop offset="55%" stop-color="#f59e0b"/>
      <stop offset="100%" stop-color="#b45309"/>
    </linearGradient>
    <linearGradient id="m-wing" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#d97706"/>
      <stop offset="100%" stop-color="#92400e"/>
    </linearGradient>
    <linearGradient id="m-beak" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#fde047"/>
      <stop offset="100%" stop-color="#f97316"/>
    </linearGradient>
  </defs>

  <ellipse class="m-shadow" cx="60" cy="112" rx="26" ry="4.5" fill="#000" opacity="0.18"/>

  <g class="m-figure">
    <g class="m-feet" fill="#f97316">
      <path d="M44 100 q4 9 8 0 z"/>
      <path d="M68 100 q4 9 8 0 z"/>
    </g>

    <g class="m-wing m-wing-left">
      <path d="M30 58 C18 64 14 80 20 96 C26 90 30 84 34 80 Z" fill="url(#m-wing)"/>
    </g>
    <g class="m-wing m-wing-right">
      <path d="M90 58 C102 64 106 80 100 96 C94 90 90 84 86 80 Z" fill="url(#m-wing)"/>
    </g>

    <g class="m-tuft" fill="#d97706">
      <path d="M54 30 C52 20 56 14 60 12 C60 20 60 26 60 30 Z"/>
      <path d="M60 30 C62 18 70 14 74 16 C70 22 66 28 64 32 Z"/>
      <path d="M56 31 C50 22 44 22 42 24 C47 27 50 30 52 34 Z"/>
    </g>

    <ellipse class="m-body" cx="60" cy="68" rx="34" ry="37" fill="url(#m-body)"/>
    <ellipse class="m-belly" cx="60" cy="84" rx="21" ry="18" fill="#fef3c7"/>
    <path class="m-belly-marks" d="M52 82 q2 2 4 0 M62 86 q2 2 4 0 M56 92 q2 2 4 0"
          stroke="#f59e0b" stroke-width="1.6" fill="none" stroke-linecap="round" opacity="0.7"/>

    <ellipse class="m-cheek" cx="37" cy="73" rx="5" ry="3" fill="#fb7185" opacity="0.45"/>
    <ellipse class="m-cheek" cx="83" cy="73" rx="5" ry="3" fill="#fb7185" opacity="0.45"/>

    <g class="m-brows" stroke="#78350f" stroke-width="2.6" stroke-linecap="round" fill="none">
      <path class="m-brow-l" d="M38 46 L55 49"/>
      <path class="m-brow-r" d="M82 46 L65 49"/>
    </g>

    <g class="m-eyes m-eyes-open">
      <circle cx="47" cy="60" r="10.5" fill="#fff"/>
      <circle cx="73" cy="60" r="10.5" fill="#fff"/>
      <g class="m-pupils">
        <circle cx="48" cy="61" r="6" fill="#1c1917"/>
        <circle cx="72" cy="61" r="6" fill="#1c1917"/>
        <circle cx="50.5" cy="58.5" r="2.2" fill="#fff"/>
        <circle cx="74.5" cy="58.5" r="2.2" fill="#fff"/>
      </g>
    </g>
    <g class="m-eyes m-eyes-happy" stroke="#1c1917" stroke-width="3.2" stroke-linecap="round" fill="none">
      <path d="M39 62 Q47 52 55 62"/>
      <path d="M65 62 Q73 52 81 62"/>
    </g>
    <g class="m-eyes m-eyes-closed" stroke="#1c1917" stroke-width="3" stroke-linecap="round" fill="none">
      <path d="M39 60 Q47 66 55 60"/>
      <path d="M65 60 Q73 66 81 60"/>
    </g>

    <g class="m-beak">
      <path class="m-beak-lower" d="M54 74 Q60 84 66 74 Z" fill="#c2410c"/>
      <path class="m-beak-upper" d="M50 69 Q60 62 70 69 Q68 77 61 82 Q60 78 56 76 Q52 73 50 69 Z" fill="url(#m-beak)"/>
    </g>
  </g>

  <!-- mood props -->
  <g class="m-prop m-dots" fill="#a8a29e">
    <circle cx="92" cy="30" r="3.2"/><circle cx="101" cy="24" r="3.6"/><circle cx="111" cy="17" r="4"/>
  </g>
  <text class="m-prop m-question" x="94" y="34" font-size="26" font-weight="800" fill="#0ea5e9"
        font-family="Segoe UI, sans-serif">?</text>
  <g class="m-prop m-zzz" fill="#94a3b8" font-family="Segoe UI, sans-serif" font-weight="700">
    <text class="z1" x="88" y="38" font-size="12">z</text>
    <text class="z2" x="97" y="27" font-size="15">z</text>
    <text class="z3" x="107" y="15" font-size="18">Z</text>
  </g>
  <path class="m-prop m-sweat" d="M95 40 q-5 8 0 11 q5 -3 0 -11 z" fill="#38bdf8"/>
  <g class="m-prop m-sparkles" fill="#fbbf24">
    <path class="s1" d="M14 30 l2 6 6 2 -6 2 -2 6 -2 -6 -6 -2 6 -2 z"/>
    <path class="s2" d="M104 46 l1.5 4.5 4.5 1.5 -4.5 1.5 -1.5 4.5 -1.5 -4.5 -4.5 -1.5 4.5 -1.5 z"/>
    <path class="s3" d="M98 14 l1.2 3.6 3.6 1.2 -3.6 1.2 -1.2 3.6 -1.2 -3.6 -3.6 -1.2 3.6 -1.2 z"/>
  </g>
  <g class="m-prop m-gear" fill="#78716c">
    <path d="M100 22 m-7 0 a7 7 0 1 0 14 0 a7 7 0 1 0 -14 0 M100 22 m-3 0 a3 3 0 1 1 6 0 a3 3 0 1 1 -6 0"
          fill-rule="evenodd"/>
    <rect x="98.5" y="11" width="3" height="4" rx="1"/><rect x="98.5" y="29" width="3" height="4" rx="1"/>
    <rect x="89" y="20.5" width="4" height="3" rx="1"/><rect x="107" y="20.5" width="4" height="3" rx="1"/>
  </g>
</svg>`;

export class Mascot {
  readonly el: HTMLElement;
  private mood: Mood = "idle";
  private settleTimer: number | undefined;
  private sleepTimer: number | undefined;
  private onChange?: (m: Mood) => void;

  constructor(host: HTMLElement, onChange?: (m: Mood) => void) {
    host.innerHTML = SVG;
    this.el = host;
    this.onChange = onChange;
    this.set("idle");
  }

  get current(): Mood {
    return this.mood;
  }

  /** Set a mood. `holdMs` makes it temporary and falls back to `idle` afterwards. */
  set(mood: Mood, holdMs = 0) {
    clearTimeout(this.settleTimer);
    if (mood !== this.mood) {
      this.el.classList.remove(`mood-${this.mood}`);
      this.el.classList.add(`mood-${mood}`);
      this.mood = mood;
      this.onChange?.(mood);
    }
    if (holdMs > 0) this.settleTimer = window.setTimeout(() => this.set("idle"), holdMs);
    this.armSleep();
  }

  /** Fall asleep after a while without anything happening. */
  private armSleep() {
    clearTimeout(this.sleepTimer);
    if (this.mood === "idle") {
      this.sleepTimer = window.setTimeout(() => this.mood === "idle" && this.set("sleeping"), 3 * 60_000);
    }
  }

  wake() {
    if (this.mood === "sleeping") this.set("idle");
    else this.armSleep();
  }

  setLookingUp(on: boolean) {
    this.el.classList.toggle("look-up", on);
  }
}
