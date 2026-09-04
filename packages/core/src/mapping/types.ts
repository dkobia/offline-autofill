import type { FillKey } from "../profile/answers";

export type MappingSource = "heuristic" | "model" | "user";

/** A form field paired with the key that should fill it: a built-in profile key or a saved answer. */
export interface FieldMapping {
  ref: string;
  key: FillKey;
  /** Which entry of a repeating section (0 is the first); saved answers ignore it. */
  entry: number;
  source: MappingSource;
  /** 0 to 1. Heuristics grade by signal strength; model mappings are fixed below them. */
  confidence: number;
}
