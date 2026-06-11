import type { Step } from "./types";

export async function runSteps(
  steps: Step[],
  shotsDir: string | null,
  capture: (path: string) => Promise<void>,
): Promise<void> {
  for (let i = 0; i < steps.length; i++) {
    await steps[i].run();
    if (shotsDir) {
      const n = String(i + 1).padStart(2, "0");
      await capture(`${shotsDir}/${n}-${steps[i].name}.png`);
    }
  }
}
