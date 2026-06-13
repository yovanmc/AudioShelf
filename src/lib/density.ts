export type Density = "compact" | "comfortable" | "spacious";
const VALID: Density[] = ["compact", "comfortable", "spacious"];
export function parseDensity(raw: string | null): Density {
  return VALID.includes(raw as Density) ? (raw as Density) : "comfortable";
}
