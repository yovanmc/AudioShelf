import type { RecapData } from "./api";
import { formatLong } from "./time";

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Build a self-contained share card SVG string for the annual recap. Pure + unit-tested. */
export function buildRecapSvg(recap: RecapData): string {
  const W = 1080;
  const H = 1350;
  const hours = formatLong(recap.totalSecs);
  const line = (
    label: string,
    value: string,
    y: number,
  ): string =>
    `<text x="80" y="${y}" font-size="30" fill="#9baabd" font-family="system-ui, sans-serif">${esc(
      label,
    )}</text>` +
    `<text x="1000" y="${y}" font-size="38" fill="#f3f7fc" text-anchor="end" font-family="system-ui, sans-serif" font-weight="600">${esc(
      value,
    )}</text>`;

  const rows: string[] = [];
  let y = 560;
  const push = (label: string, value: string) => {
    rows.push(line(label, value, y));
    y += 92;
  };
  push("Time listened", hours);
  push("Chapters finished", String(recap.totalChapters));
  push("Active days", String(recap.activeDays));
  push("Longest run", `${recap.longestStreak} day${recap.longestStreak === 1 ? "" : "s"}`);
  if (recap.topCreator) push("Top creator", recap.topCreator);
  if (recap.topTag) push("Top tag", recap.topTag);
  if (recap.busiestMonth) push("Busiest month", recap.busiestMonth);
  if (recap.busiestWeekday) push("Busiest day", recap.busiestWeekday);

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`,
    `<rect width="${W}" height="${H}" fill="#080b10"/>`,
    `<rect x="40" y="40" width="${W - 80}" height="${H - 80}" rx="28" fill="#121a26" stroke="#26364a"/>`,
    `<text x="80" y="190" font-size="34" fill="#218bff" font-family="system-ui, sans-serif" font-weight="700" letter-spacing="2">AUDIOSHELF</text>`,
    `<text x="80" y="300" font-size="84" fill="#f3f7fc" font-family="system-ui, sans-serif" font-weight="800">Your Year in</text>`,
    `<text x="80" y="396" font-size="84" fill="#f3f7fc" font-family="system-ui, sans-serif" font-weight="800">Listening</text>`,
    `<text x="80" y="470" font-size="120" fill="#218bff" font-family="system-ui, sans-serif" font-weight="800">${recap.year}</text>`,
    ...rows,
    `<text x="80" y="${H - 80}" font-size="26" fill="#9baabd" font-family="system-ui, sans-serif">Made with AudioShelf · self-knowledge, not scorekeeping</text>`,
    `</svg>`,
  ].join("");
}
