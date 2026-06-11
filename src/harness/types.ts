export interface Step {
  name: string;
  run: () => Promise<void>;
}
