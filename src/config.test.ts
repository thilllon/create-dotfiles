import { readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CONFIG_FILE, loadConfig, parseConfig } from "./config";
import { DotfileError } from "./errors";
import { makeTempDir } from "./test-helpers";

describe("loadConfig", () => {
  let home: string;

  beforeEach(() => {
    home = makeTempDir();
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it("returns an empty config and creates nothing when the file is missing", () => {
    expect(loadConfig(home)).toEqual({ include: [], exclude: [], settings: {} });
    expect(readdirSync(home)).toEqual([]);
  });

  it("reads include, exclude and every setting", () => {
    writeFileSync(
      join(home, CONFIG_FILE),
      [
        "[files]",
        'include = [".config/app", "notes/todo.md"]',
        'exclude = ["secret", ".config/app/tmp"]',
        "",
        "[settings]",
        "max_file_size_mb = 25",
        "include_env = true",
        "include_config = true",
        'formats = ["zip", "tar.gz"]',
        'out = "~/backups"',
      ].join("\n")
    );

    expect(loadConfig(home)).toEqual({
      include: [".config/app", "notes/todo.md"],
      exclude: ["secret", ".config/app/tmp"],
      settings: {
        maxFileSizeMb: 25,
        includeEnv: true,
        includeConfig: true,
        formats: ["zip", "tar"],
        out: "~/backups",
      },
    });
  });

  it("treats the legacy [files] list key as include and merges it with include", () => {
    writeFileSync(
      join(home, CONFIG_FILE),
      `[files]\nlist = [".zshrc", ".config/app"]\ninclude = [".config/app", ".vimrc"]\n`
    );

    expect(loadConfig(home).include).toEqual([".zshrc", ".config/app", ".vimrc"]);
  });

  it("names the config path in errors", () => {
    writeFileSync(join(home, CONFIG_FILE), "[files]\ninclude = 1\n");

    expect(() => loadConfig(home)).toThrow(join(home, CONFIG_FILE));
  });
});

describe("parseConfig", () => {
  const home = "/home/example";

  it("accepts an empty document and sections without keys", () => {
    expect(parseConfig("", home)).toEqual({ include: [], exclude: [], settings: {} });
    expect(parseConfig("[files]\n[settings]\n", home)).toEqual({
      include: [],
      exclude: [],
      settings: {},
    });
  });

  it.each([
    ["malformed TOML", "[files\ninclude = broken", /Invalid TOML/],
    ["a [files] value that is not a table", "files = 1", /\[files\] must be a table/],
    ["a [settings] value that is not a table", 'settings = "x"', /\[settings\] must be a table/],
    ["a non-array include", '[files]\ninclude = ".zshrc"', /files\.include must be an array/],
    ["a non-array legacy list", '[files]\nlist = ".zshrc"', /files\.list must be an array/],
    ["a non-string include entry", "[files]\ninclude = [1]", /non-empty strings/],
    ["an empty include entry", '[files]\ninclude = [" "]', /non-empty strings/],
    ["an absolute include entry", '[files]\ninclude = ["/etc/passwd"]', /must be a relative path/],
    ["an include entry escaping home", '[files]\ninclude = ["../x"]', /must stay inside/],
    ["an include entry naming home itself", '[files]\ninclude = ["."]', /must stay inside/],
    ["an exclude entry escaping home", '[files]\nexclude = ["../x"]', /must stay inside/],
    ["a non-numeric size cap", '[settings]\nmax_file_size_mb = "10"', /positive number/],
    ["a zero size cap", "[settings]\nmax_file_size_mb = 0", /positive number/],
    ["a negative size cap", "[settings]\nmax_file_size_mb = -1", /positive number/],
    [
      "a non-boolean include_env",
      '[settings]\ninclude_env = "yes"',
      /include_env must be true or false/,
    ],
    [
      "a non-boolean include_config",
      "[settings]\ninclude_config = 1",
      /include_config must be true/,
    ],
    ["a non-array formats", '[settings]\nformats = "zip"', /formats must be an array/],
    ["a formats array with non-strings", "[settings]\nformats = [1]", /formats must be an array/],
    ["an unknown format", '[settings]\nformats = ["rar"]', /Unknown output format "rar"/],
    ["an empty formats array", "[settings]\nformats = []", /At least one output format/],
    ["a non-string out", "[settings]\nout = 3", /out must be a non-empty string/],
    ["an empty out", '[settings]\nout = ""', /out must be a non-empty string/],
  ])("rejects %s with a DotfileError", (_label, content, message) => {
    expect(() => parseConfig(content, home)).toThrow(DotfileError);
    expect(() => parseConfig(content, home)).toThrow(message);
  });

  it("does not leak the TOML parser's error class name", () => {
    let error: unknown;
    try {
      parseConfig("[files\nx", home);
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(DotfileError);
    expect((error as Error).name).toBe("DotfileError");
  });
});
