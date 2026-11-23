export interface GateStep {
  name: string;
  script: string;
}
export const STEPS: GateStep[];
export interface GateOptions {
  only: string[] | null;
  skip: string[];
  keepGoing: boolean;
  list: boolean;
  help: boolean;
  errors: string[];
}
export function parseGateArgs(argv: string[]): GateOptions;
export function selectSteps(
  steps: GateStep[],
  options: Pick<GateOptions, "only" | "skip">,
): { steps: GateStep[]; unknown: string[] };
export function lastLines(text: string, count: number): string;
export function noteLines(text: string): string[];
export function stepLine(name: string, ok: boolean, seconds: number, width?: number): string;
