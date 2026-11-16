import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import {
  BYTE_ORDER_MARK,
  DEFAULT_ENV_SORT_MODE,
  ENV_ASSIGNMENT_SIGN,
  ENV_COMMENT_PREFIX,
  ENV_EXAMPLE_FILE,
  ENV_KEY_LINE,
  ENV_QUOTES,
  ENV_SECTION_MARKER,
  ENV_SORT_MODES,
  ENV_TEMPLATE_FILES,
  ENV_TEMPLATE_SUFFIXES,
  ENV_VALUE_TAIL,
  ENV_FILE_NAME,
  LINE_BREAK,
} from "./constants";
import { DotfileError } from "./errors";
import { Targets } from "./targets";

/** `section`: sort inside each `## ---` section. `all`: sort the whole file as one list. */
export type EnvSortMode = "section" | "all";

/** One variable: its key, the comment lines directly above it, and its own line(s). */
export interface EnvEntry {
  key: string;
  /** Comment lines with no blank line between them and the key; they move with it. */
  comments: string[];
  /** The `KEY=value` line, plus the following lines of a quoted multi-line value. */
  lines: string[];
}

/** A run of entries under one `## ---` header (no header for the part before the first one). */
export interface EnvSection {
  header?: string;
  /** Comments not attached to a key (a blank line follows them); kept at the top, in order. */
  floating: string[];
  entries: EnvEntry[];
}

export interface EnvDocument {
  sections: EnvSection[];
  /** The file's line ending, kept on output. */
  eol: "\n" | "\r\n";
  /** Whether the file starts with a UTF-8 byte order mark, kept on output. */
  bom: boolean;
}

/** Parsing and sorting of `.env` file text. Nothing here touches the disk. */
export class EnvFile {
  /**
   * Splits `.env` text into sections and entries. With `sections` false a `## ---` line is an
   * ordinary comment, so the whole file is one section.
   */
  static parse(content: string, sections = true): EnvDocument {
    const bom = content.startsWith(BYTE_ORDER_MARK);
    const text = bom ? content.slice(1) : content;
    const eol = text.includes("\r\n") ? "\r\n" : "\n";
    const lines = text.split(LINE_BREAK);
    if (lines[lines.length - 1] === "") {
      lines.pop();
    }

    const result: EnvSection[] = [{ floating: [], entries: [] }];
    let section = result[0];
    let pending: string[] = [];
    let last: EnvEntry | undefined;

    const flush = () => {
      section.floating.push(...pending);
      pending = [];
    };

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      if (trimmed === "") {
        flush();
        last = undefined;
        continue;
      }
      if (sections && trimmed.startsWith(ENV_SECTION_MARKER)) {
        flush();
        section = { header: line, floating: [], entries: [] };
        result.push(section);
        last = undefined;
        continue;
      }
      if (trimmed.startsWith(ENV_COMMENT_PREFIX)) {
        pending.push(line);
        continue;
      }

      const match = ENV_KEY_LINE.exec(line);
      if (match === null) {
        // Not a variable: it stays with the entry above it, or with the comments below.
        if (last !== undefined && pending.length === 0) {
          last.lines.push(line);
        } else {
          pending.push(line);
        }
        continue;
      }

      const entry: EnvEntry = { key: match[1], comments: pending, lines: [line] };
      pending = [];
      const quote = openQuote(line.slice(match[0].length));
      if (quote !== undefined) {
        // The value ends at the next unescaped quote, which must end its line (bar a comment).
        // Anything else (a quote that never closes, or one that opens the next assignment) is
        // a typo, not a value running on: dotenv reads such a line as a single-line value, and
        // so does this.
        const close = closingLine(lines, i + 1, quote);
        if (close !== undefined) {
          entry.lines.push(...lines.slice(i + 1, close + 1));
          i = close;
        }
      }
      section.entries.push(entry);
      last = entry;
    }
    flush();

    return { sections: result, eol, bom };
  }

  /** Every key in the text, in file order (a key set twice appears twice). */
  static keys(content: string): string[] {
    return EnvFile.parse(content, false).sections.flatMap((s) => s.entries.map((e) => e.key));
  }

  /**
   * The text with its keys in alphabetical (code point) order, inside each section or across
   * the whole file. Comments directly above a key move with it; unattached comments go to the
   * top of their section. The result is stable: sorting it again changes nothing.
   */
  static sort(content: string, mode: EnvSortMode = DEFAULT_ENV_SORT_MODE): string {
    const doc = EnvFile.parse(content, mode === "section");
    for (const section of doc.sections) {
      section.entries.sort((a, b) => compareKeys(a.key, b.key));
    }
    return EnvFile.format(doc);
  }

  /** Whether {@link sort} would leave the text exactly as it is. */
  static isSorted(content: string, mode: EnvSortMode = DEFAULT_ENV_SORT_MODE): boolean {
    return EnvFile.sort(content, mode) === content;
  }

  /** Writes a document back out: one blank line between sections and before commented keys. */
  static format(doc: EnvDocument): string {
    const blocks = doc.sections
      .map((section) => {
        const lines: string[] = [];
        if (section.header !== undefined) {
          lines.push(section.header);
        }
        lines.push(...section.floating);
        if (section.floating.length > 0 && section.entries.length > 0) {
          lines.push("");
        }
        section.entries.forEach((entry, index) => {
          if (index > 0 && entry.comments.length > 0) {
            lines.push("");
          }
          lines.push(...entry.comments, ...entry.lines);
        });
        return lines;
      })
      .filter((lines) => lines.length > 0);

    if (blocks.length === 0) {
      return doc.bom ? BYTE_ORDER_MARK : "";
    }
    const body = blocks.map((lines) => lines.join(doc.eol)).join(doc.eol + doc.eol);
    return `${doc.bom ? BYTE_ORDER_MARK : ""}${body}${doc.eol}`;
  }

  /** Reads a `--mode` value. */
  static parseMode(value: unknown): EnvSortMode {
    const mode = String(value).trim().toLowerCase();
    const known = ENV_SORT_MODES.find((m) => m === mode);
    if (known === undefined) {
      throw new DotfileError(
        `Unknown sort mode "${String(value)}" (expected ${ENV_SORT_MODES.join(" or ")})`
      );
    }
    return known;
  }

  /**
   * The `.env` and `.env.*` regular files directly inside a directory (not below it), `.env`
   * first and the rest by name.
   */
  static findIn(dir: string): string[] {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch (err) {
      throw new DotfileError(`Cannot read ${dir}: ${(err as Error).message}`);
    }
    return names
      .filter((name) => Targets.isEnvFile(name) && isFile(join(dir, name)))
      .sort((a, b) => (a === ENV_FILE_NAME ? -1 : b === ENV_FILE_NAME ? 1 : compareKeys(a, b)));
  }

  /** Sorts `.env` files on disk; see {@link EnvSortOptions}. */
  static sortFiles(options: EnvSortOptions = {}): EnvSortSummary {
    const dir = resolve(options.dir ?? process.cwd());
    const mode = options.mode ?? DEFAULT_ENV_SORT_MODE;
    const check = options.check ?? false;
    const files =
      options.files !== undefined && options.files.length > 0
        ? options.files.map((file) => resolve(dir, file))
        : EnvFile.findIn(dir).map((name) => join(dir, name));
    if (files.length === 0) {
      throw new DotfileError(`No .env files in ${dir}`);
    }

    const changed: string[] = [];
    const unchanged: string[] = [];
    for (const file of files) {
      const content = readText(file);
      const sorted = EnvFile.sort(content, mode);
      if (sorted === content) {
        unchanged.push(file);
        continue;
      }
      if (!check) {
        writeText(file, sorted);
      }
      changed.push(file);
    }
    return { mode, check, changed, unchanged };
  }
}

export interface EnvSortOptions {
  /** Directory that relative `files` resolve against and that is searched when none are given. Defaults to the current directory. */
  dir?: string;
  /** Files to sort. Defaults to every `.env` and `.env.*` file in `dir`, templates included. */
  files?: readonly string[];
  /** Default `section`. */
  mode?: EnvSortMode;
  /** Write nothing; `changed` then lists the files that are not sorted. */
  check?: boolean;
}

export interface EnvSortSummary {
  mode: EnvSortMode;
  check: boolean;
  /** Absolute paths that were sorted (or, with `check`, would be). */
  changed: string[];
  /** Absolute paths that were already sorted. */
  unchanged: string[];
}

export interface EnvSource {
  /** Shown in summaries; usually the file name. */
  name: string;
  content: string;
}

export interface EnvExampleOptions {
  /** Directory holding the `.env` files. Defaults to the current directory. */
  dir?: string;
  /** File to write. Defaults to `.env.example` in `dir`; relative paths resolve against `dir`. */
  out?: string;
  /**
   * Copy the `#` comments directly above each key (never one with `=`). Default false: a comment
   * may hold a secret, so only `## ---` section headers are copied.
   */
  keepComments?: boolean;
  /** Sort the result as well. Default: leave the order as built. */
  sort?: EnvSortMode;
  /** Build the result without writing it. Default false. */
  dryRun?: boolean;
}

export interface EnvExampleSummary {
  /** Absolute path of the example file. */
  path: string;
  /** Names of the files the keys were read from. */
  sources: string[];
  /** Keys that were not in the example file before, in the order they were added. */
  added: string[];
  /** Whether the example file did not exist before. */
  created: boolean;
  /** Whether the content differs from the file on disk (new keys, or a new order with `sort`). */
  changed: boolean;
  /** Whether the file was written: changed, and not a dry run. */
  written: boolean;
  content: string;
}

/** `.env.example` as the union of the keys of a project's `.env` files, values left empty. */
export class EnvExample {
  /** Whether a file name is a template (`.env.example`, `.env.local.sample`, ...), not a source. */
  static isTemplate(name: string): boolean {
    return (
      ENV_TEMPLATE_FILES.includes(name) ||
      ENV_TEMPLATE_SUFFIXES.some((suffix) => name.startsWith(".env.") && name.endsWith(suffix))
    );
  }

  /**
   * The example text: `existing` (an earlier example file) kept as it is, then every key from
   * `sources` it lacks, in the order the keys first appear. Values are always left empty, so no
   * secret reaches the example. Of the lines directly above a key only `## ---` section headers
   * come along, or with `keepComments` any `#` comment; never a line with `=` (see
   * {@link carriedComment}). The existing text is kept byte for byte.
   */
  static build(
    sources: readonly EnvSource[],
    existing?: string,
    options: { keepComments?: boolean } = {}
  ): { content: string; added: string[] } {
    const keepComments = options.keepComments ?? false;
    const seen = new Set(existing === undefined ? [] : EnvFile.keys(existing));
    const added: EnvEntry[] = [];

    for (const source of sources) {
      for (const section of EnvFile.parse(source.content, false).sections) {
        for (const entry of section.entries) {
          if (seen.has(entry.key)) {
            continue;
          }
          seen.add(entry.key);
          added.push({
            key: entry.key,
            comments: entry.comments.filter((line) => carriedComment(line, keepComments)),
            lines: [`${entry.key}=`],
          });
        }
      }
    }

    const keys = added.map((entry) => entry.key);
    if (existing !== undefined && added.length === 0) {
      return { content: existing, added: keys };
    }
    if (existing === undefined || existing.trim() === "") {
      return { content: formatEntries(added, "\n"), added: keys };
    }
    // The existing text is kept byte for byte; the new keys follow in its own line ending.
    const eol = EnvFile.parse(existing).eol;
    const base = existing.endsWith("\n") ? existing : existing + eol;
    return { content: `${base}${eol}${formatEntries(added, eol)}`, added: keys };
  }

  /** Reads the `.env` files of a directory and writes (or updates) its `.env.example`. */
  static generate(options: EnvExampleOptions = {}): EnvExampleSummary {
    const dir = resolve(options.dir ?? process.cwd());
    const path = resolve(dir, options.out ?? ENV_EXAMPLE_FILE);
    const outName = dirname(path) === dir ? basename(path) : undefined;

    const sources = EnvFile.findIn(dir)
      .filter((name) => !EnvExample.isTemplate(name) && name !== outName)
      .map((name) => ({ name, content: readText(join(dir, name)) }));
    if (sources.length === 0) {
      throw new DotfileError(
        `No .env files to read in ${dir} (templates such as ${ENV_EXAMPLE_FILE} are not read)`
      );
    }

    const created = !existsSync(path);
    const existing = created ? undefined : readText(path);
    const built = EnvExample.build(sources, existing, { keepComments: options.keepComments });
    const content =
      options.sort === undefined ? built.content : EnvFile.sort(built.content, options.sort);

    const changed = content !== existing;
    const written = changed && !(options.dryRun ?? false);
    if (written) {
      writeText(path, content);
    }
    return {
      path,
      sources: sources.map((source) => source.name),
      added: built.added,
      created,
      changed,
      written,
      content,
    };
  }
}

function formatEntries(entries: EnvEntry[], eol: EnvDocument["eol"]): string {
  return EnvFile.format({ sections: [{ floating: [], entries }], eol, bom: false });
}

/**
 * Whether a line above a key goes into the example. A comment can hold a secret as easily as a
 * value (`# token: sk_live_...`), so by default only `## ---` section headers do; with
 * `keepComments` any `#` comment does. A line with `=` (a commented-out assignment) never does,
 * nor does a line that is not a comment at all (a stray value, part of a broken multi-line value).
 */
function carriedComment(line: string, keepComments: boolean): boolean {
  const text = line.trimStart();
  if (!text.startsWith(ENV_COMMENT_PREFIX) || line.includes(ENV_ASSIGNMENT_SIGN)) {
    return false;
  }
  return keepComments || text.startsWith(ENV_SECTION_MARKER);
}

/** Code point order, so the result is the same in every locale. */
function compareKeys(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

/** The quote a value opens without closing on the same line, if any. */
function openQuote(value: string): string | undefined {
  const text = value.trimStart();
  const quote = ENV_QUOTES.find((q) => text.startsWith(q));
  if (quote === undefined) {
    return undefined;
  }
  return findQuote(text.slice(1), quote) === -1 ? quote : undefined;
}

/**
 * The line that closes a multi-line value opened on an earlier line: the first line holding an
 * unescaped `quote`, provided only whitespace or a comment follows it. Undefined when there is
 * no such line, so the opening line is read as a single-line value.
 */
function closingLine(lines: readonly string[], from: number, quote: string): number | undefined {
  for (let j = from; j < lines.length; j++) {
    const index = findQuote(lines[j], quote);
    if (index === -1) {
      continue;
    }
    return ENV_VALUE_TAIL.test(lines[j].slice(index + 1)) ? j : undefined;
  }
  return undefined;
}

/** The index of the first `quote` not escaped by a backslash, or -1. dotenv escapes all three. */
function findQuote(text: string, quote: string): number {
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\") {
      i++;
      continue;
    }
    if (text[i] === quote) {
      return i;
    }
  }
  return -1;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function readText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (err) {
    throw new DotfileError(`Cannot read ${path}: ${(err as Error).message}`);
  }
}

function writeText(path: string, content: string): void {
  try {
    writeFileSync(path, content);
  } catch (err) {
    throw new DotfileError(`Cannot write ${path}: ${(err as Error).message}`);
  }
}
