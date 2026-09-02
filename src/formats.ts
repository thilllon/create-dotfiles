import { DotfileError } from "./errors";

export type OutputFormat = "folder" | "zip" | "tar";

export const OUTPUT_FORMATS: readonly OutputFormat[] = ["folder", "zip", "tar"];

const FORMAT_ALIASES: Readonly<Record<string, OutputFormat>> = {
  folder: "folder",
  zip: "zip",
  tar: "tar",
  "tar.gz": "tar",
  tgz: "tar",
};

/**
 * Parses `--format folder,zip` style input (or an already split list) into a de-duplicated
 * list of formats. `tar.gz` and `tgz` are accepted as spellings of `tar`.
 */
export function parseFormats(input: string | readonly string[]): OutputFormat[] {
  // Anything that is not a list is treated as one value; a caller ignoring the types (or cac
  // handing over a number) gets "Unknown output format", not a TypeError.
  const items = Array.isArray(input) ? input : [input];
  const formats: OutputFormat[] = [];

  for (const item of items.flatMap((value) => String(value).split(","))) {
    const key = item.trim().toLowerCase();
    if (key === "") continue;
    const format = FORMAT_ALIASES[key];
    if (format === undefined) {
      throw new DotfileError(
        `Unknown output format "${item.trim()}" (expected folder, zip or tar)`
      );
    }
    if (!formats.includes(format)) formats.push(format);
  }

  if (formats.length === 0) {
    throw new DotfileError("At least one output format is required (folder, zip or tar)");
  }
  return formats;
}
