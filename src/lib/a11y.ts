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
/** data-* attribute map to spread on the shell root. Omit a key when it equals the default
 * so dark/normal stays attribute-free (cleaner CSS + matches the no-attr baseline). */
export function a11yDataAttrs(p: A11yPrefs): Record<string, string> {
  const a: Record<string, string> = {};
  if (p.theme !== "dark") a["data-theme"] = p.theme;
  if (p.textSize !== "normal") a["data-text-size"] = p.textSize;
  if (p.dyslexiaFont) a["data-font"] = "dyslexia";
  if (p.reducedMotion) a["data-reduced-motion"] = "true";
  return a;
}
