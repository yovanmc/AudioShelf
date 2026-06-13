export type Theme = "dark" | "light" | "high-contrast";
export type TextSize = "normal" | "large" | "xlarge";
export interface A11yPrefs {
  theme: Theme;
  textSize: TextSize;
  dyslexiaFont: boolean;
  reducedMotion: boolean;   // manual override; OS prefers-reduced-motion also applies via CSS
}
export const DEFAULT_A11Y: A11yPrefs = { theme: "dark", textSize: "normal", dyslexiaFont: false, reducedMotion: false };
const THEMES: Theme[] = ["dark", "light", "high-contrast"];
const SIZES: TextSize[] = ["normal", "large", "xlarge"];
export function parseA11yPrefs(raw: string | null): A11yPrefs {
  if (!raw) return { ...DEFAULT_A11Y };
  try {
    const o = JSON.parse(raw) as Partial<A11yPrefs>;
    return {
      theme: THEMES.includes(o.theme as Theme) ? (o.theme as Theme) : "dark",
      textSize: SIZES.includes(o.textSize as TextSize) ? (o.textSize as TextSize) : "normal",
      dyslexiaFont: o.dyslexiaFont === true,
      reducedMotion: o.reducedMotion === true,
    };
  } catch { return { ...DEFAULT_A11Y }; }
}
/** data-* attribute map to spread on the shell root.
 * Always returns all keys; uses undefined (not omission) for default values so
 * React's reconciler removes stale attributes when a pref resets to default.
 * (Spreading a dynamic object that drops a key leaves the old DOM attribute in
 * place; only an explicit undefined causes React to remove it.) */
export function a11yDataAttrs(p: A11yPrefs): Record<string, string | undefined> {
  return {
    "data-theme":         p.theme !== "dark"    ? p.theme       : undefined,
    "data-text-size":     p.textSize !== "normal" ? p.textSize   : undefined,
    "data-font":          p.dyslexiaFont          ? "dyslexia"   : undefined,
    "data-reduced-motion": p.reducedMotion        ? "true"       : undefined,
  };
}
