import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EnvExample, EnvFile } from "./env";
import { DotfileError } from "./errors";
import { Reporter } from "./report";
import { createFile, makeTempDir } from "./tests/helpers";

const lines = (...text: string[]) => `${text.join("\n")}\n`;

describe("EnvFile.parse", () => {
  it("attaches comments directly above a key and leaves the others floating", () => {
    const doc = EnvFile.parse(lines("# about the file", "", "# the port", "PORT=1", "HOST=x"));

    expect(doc.sections).toHaveLength(1);
    expect(doc.sections[0].floating).toEqual(["# about the file"]);
    expect(doc.sections[0].entries).toEqual([
      { key: "PORT", comments: ["# the port"], lines: ["PORT=1"] },
      { key: "HOST", comments: [], lines: ["HOST=x"] },
    ]);
  });

  it("opens a section at every '## ---' line, unless sections are off", () => {
    const text = lines("A=1", "## --- db", "B=2", "## --- app", "C=3");

    const doc = EnvFile.parse(text);
    expect(doc.sections.map((s) => s.header)).toEqual([undefined, "## --- db", "## --- app"]);
    expect(doc.sections.map((s) => s.entries.map((e) => e.key))).toEqual([["A"], ["B"], ["C"]]);

    const flat = EnvFile.parse(text, false);
    expect(flat.sections).toHaveLength(1);
    expect(flat.sections[0].entries[1].comments).toEqual(["## --- db"]);
  });

  it("reads `export` prefixes and spaces around the equals sign", () => {
    expect(EnvFile.keys(lines("export A=1", "  B = 2", "C.D-E=3"))).toEqual(["A", "B", "C.D-E"]);
  });

  it("keeps a quoted value that spans several lines together", () => {
    const doc = EnvFile.parse(
      lines('KEY="-----BEGIN', 'with \\" an escaped quote', 'END"', "SINGLE='a", "b'", "NEXT=1")
    );

    expect(doc.sections[0].entries.map((e) => e.lines)).toEqual([
      ['KEY="-----BEGIN', 'with \\" an escaped quote', 'END"'],
      ["SINGLE='a", "b'"],
      ["NEXT=1"],
    ]);
  });

  it("does not treat a quote closed on the same line as multi-line", () => {
    expect(EnvFile.keys(lines('A="x"', "B=`y`", "C='z' # note", "D=1"))).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]);
  });

  it("reads a quote that never closes as a single-line value, as dotenv does", () => {
    for (const quote of ['"', "'", "`"]) {
      const doc = EnvFile.parse(lines(`A=${quote}open`, "## --- s", "B=2"));

      expect(doc.sections.flatMap((s) => s.entries.map((e) => e.lines))).toEqual([
        [`A=${quote}open`],
        ["B=2"],
      ]);
    }
  });

  it("does not let a quote that opens a later assignment close an unclosed value", () => {
    expect(EnvFile.keys(lines('BROKEN="unterminated', 'NEXT="ok"', "LAST=1"))).toEqual([
      "BROKEN",
      "NEXT",
      "LAST",
    ]);
  });

  it("honours backslash-escaped quotes inside single quotes and backticks too", () => {
    for (const quote of ["'", "`"]) {
      const doc = EnvFile.parse(
        lines(
          `Z=${quote}first`,
          `it\\${quote}s still the value`,
          "## --- not a header",
          `end${quote}`,
          "A=1"
        )
      );

      expect(doc.sections).toHaveLength(1);
      expect(doc.sections[0].entries.map((e) => e.key)).toEqual(["Z", "A"]);
    }
  });

  it("accepts a closing quote followed by a comment", () => {
    expect(EnvFile.parse(lines('A="x', 'y" # note', "B=1")).sections[0].entries[0].lines).toEqual([
      'A="x',
      'y" # note',
    ]);
  });

  it("accepts every key name dotenv does", () => {
    expect(EnvFile.keys(lines("1PASSWORD=x", ".TOKEN=y", "-FLAG=z", "a.b-c_d=w"))).toEqual([
      "1PASSWORD",
      ".TOKEN",
      "-FLAG",
      "a.b-c_d",
    ]);
  });

  it("reads dotenv's `KEY: value` form as a key", () => {
    expect(EnvFile.keys(lines("A: 1", "B:", "C:not-a-key", "URL=http://x"))).toEqual([
      "A",
      "B",
      "URL",
    ]);
  });

  it("keeps a line that is not a variable with the entry above it", () => {
    const doc = EnvFile.parse(lines("A=1", "not a variable", "", "stray", "B=2"));

    expect(doc.sections[0].entries).toEqual([
      { key: "A", comments: [], lines: ["A=1", "not a variable"] },
      { key: "B", comments: ["stray"], lines: ["B=2"] },
    ]);
  });

  it("remembers CRLF line endings and a byte order mark", () => {
    const doc = EnvFile.parse("﻿A=1\r\nB=2\r\n");

    expect(doc.eol).toBe("\r\n");
    expect(doc.bom).toBe(true);
    expect(doc.sections[0].entries.map((e) => e.key)).toEqual(["A", "B"]);
  });
});

describe("EnvFile.sort", () => {
  const sectioned = lines(
    "# generated",
    "",
    "ZED=1",
    "ALPHA=2",
    "## --- services",
    "# stripe",
    "STRIPE=x",
    "AWS=y",
    "## --- app",
    "PORT=3",
    "HOST=4"
  );

  it("sorts inside each section by default and keeps the headers in place", () => {
    expect(EnvFile.sort(sectioned)).toBe(
      lines(
        "# generated",
        "",
        "ALPHA=2",
        "ZED=1",
        "",
        "## --- services",
        "AWS=y",
        "",
        "# stripe",
        "STRIPE=x",
        "",
        "## --- app",
        "HOST=4",
        "PORT=3"
      )
    );
  });

  it("sorts the whole file with mode all; a header moves with the key below it", () => {
    expect(EnvFile.sort(sectioned, "all")).toBe(
      lines(
        "# generated",
        "",
        "ALPHA=2",
        "AWS=y",
        "HOST=4",
        "",
        "## --- app",
        "PORT=3",
        "",
        "## --- services",
        "# stripe",
        "STRIPE=x",
        "ZED=1"
      )
    );
  });

  it("is the same as mode all for a file without sections", () => {
    const text = lines("B=1", "A=2", "C=3");

    expect(EnvFile.sort(text, "section")).toBe(EnvFile.sort(text, "all"));
    expect(EnvFile.sort(text)).toBe(lines("A=2", "B=1", "C=3"));
  });

  it("changes nothing when run again", () => {
    for (const mode of ["section", "all"] as const) {
      const once = EnvFile.sort(sectioned, mode);
      expect(EnvFile.sort(once, mode)).toBe(once);
      expect(EnvFile.isSorted(once, mode)).toBe(true);
    }
  });

  it("orders by code point and keeps duplicate keys in their original order", () => {
    expect(EnvFile.sort(lines("b=1", "B=2", "A_=3", "A=4", "B=5"))).toBe(
      lines("A=4", "A_=3", "B=2", "B=5", "b=1")
    );
  });

  it("moves a multi-line value as one entry", () => {
    expect(EnvFile.sort(lines('Z="a', 'b"', "A=1"))).toBe(lines("A=1", 'Z="a', 'b"'));
  });

  it("keeps CRLF line endings and the byte order mark", () => {
    expect(EnvFile.sort("﻿B=1\r\nA=2\r\n")).toBe("﻿A=2\r\nB=1\r\n");
  });

  it("drops blank lines between keys and adds a final newline", () => {
    expect(EnvFile.sort("A=1\n\n\n\nB=2")).toBe(lines("A=1", "B=2"));
  });

  it("still sorts the keys after a quote that never closes", () => {
    expect(EnvFile.sort(lines('B="oops', "## --- s", "Z=1", "A=1"))).toBe(
      lines('B="oops', "", "## --- s", "A=1", "Z=1")
    );
  });

  it("leaves an empty file empty", () => {
    expect(EnvFile.sort("")).toBe("");
    expect(EnvFile.sort("\n\n")).toBe("");
    expect(EnvFile.sort("﻿")).toBe("﻿");
  });

  it("keeps a section that has only a header or only comments", () => {
    const text = lines("A=1", "", "## --- empty", "", "## --- notes", "# todo");

    expect(EnvFile.sort(text)).toBe(lines("A=1", "", "## --- empty", "", "## --- notes", "# todo"));
  });
});

describe("EnvFile.isSorted", () => {
  it("is false when sorting would change the text", () => {
    expect(EnvFile.isSorted(lines("B=1", "A=2"))).toBe(false);
    expect(EnvFile.isSorted(lines("A=1", "B=2"))).toBe(true);
  });
});

describe("EnvFile.parseMode", () => {
  it("accepts the modes in any case", () => {
    expect(EnvFile.parseMode("section")).toBe("section");
    expect(EnvFile.parseMode(" ALL ")).toBe("all");
  });

  it("rejects anything else, including what cac makes of an empty value", () => {
    expect(() => EnvFile.parseMode("alpha")).toThrow(DotfileError);
    expect(() => EnvFile.parseMode(0)).toThrow('Unknown sort mode "0" (expected section or all)');
  });
});

describe("files on disk", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir("dotfiles-env-");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  describe("EnvFile.findIn", () => {
    it("lists .env first, then the other .env.* files by name, and nothing else", () => {
      createFile(dir, ".env.production", "");
      createFile(dir, ".env", "");
      createFile(dir, ".env.example", "");
      createFile(dir, ".envrc", "");
      createFile(dir, "app.env", "");
      createFile(dir, "nested/.env", "");
      mkdirSync(join(dir, ".env.d"));

      expect(EnvFile.findIn(dir)).toEqual([".env", ".env.example", ".env.production"]);
    });

    it("reports a directory it cannot read", () => {
      expect(() => EnvFile.findIn(join(dir, "missing"))).toThrow(DotfileError);
    });
  });

  describe("EnvFile.sortFiles", () => {
    it("sorts every .env file in the directory and writes only the ones that change", () => {
      createFile(dir, ".env", lines("B=1", "A=2"));
      createFile(dir, ".env.test", lines("A=1", "B=2"));

      const summary = EnvFile.sortFiles({ dir });

      expect(summary).toEqual({
        mode: "section",
        check: false,
        changed: [join(dir, ".env")],
        unchanged: [join(dir, ".env.test")],
      });
      expect(readFileSync(join(dir, ".env"), "utf8")).toBe(lines("A=2", "B=1"));
    });

    it("writes nothing with check", () => {
      createFile(dir, ".env", lines("B=1", "A=2"));

      const summary = EnvFile.sortFiles({ dir, check: true, mode: "all" });

      expect(summary.changed).toEqual([join(dir, ".env")]);
      expect(readFileSync(join(dir, ".env"), "utf8")).toBe(lines("B=1", "A=2"));
    });

    it("sorts only the files named, relative to the directory", () => {
      createFile(dir, "config/app.env", lines("B=1", "A=2"));
      createFile(dir, ".env", lines("B=1", "A=2"));

      const summary = EnvFile.sortFiles({ dir, files: ["config/app.env"] });

      expect(summary.changed).toEqual([join(dir, "config/app.env")]);
      expect(readFileSync(join(dir, ".env"), "utf8")).toBe(lines("B=1", "A=2"));
    });

    it("fails without any .env file", () => {
      expect(() => EnvFile.sortFiles({ dir })).toThrow(`No .env files in ${dir}`);
    });

    it("reports a file it cannot read", () => {
      expect(() => EnvFile.sortFiles({ dir, files: ["missing.env"] })).toThrow(DotfileError);
    });
  });

  describe("EnvExample.generate", () => {
    beforeEach(() => {
      createFile(dir, ".env", lines("# database", "DB_URL=postgres://secret", "PORT=3000"));
      createFile(
        dir,
        ".env.production",
        lines("PORT=80", "# old: OLD_KEY=sk-live-1", "#OLD_KEY=sk-live-2", "SENTRY_DSN=https://x")
      );
    });

    it("copies the comments with keepComments", () => {
      EnvExample.generate({ dir, keepComments: true });

      expect(readFileSync(join(dir, ".env.example"), "utf8")).toBe(
        lines("# database", "DB_URL=", "PORT=", "SENTRY_DSN=")
      );
    });

    it("writes the union of the keys with every value left empty", () => {
      const summary = EnvExample.generate({ dir });

      expect(summary).toMatchObject({
        path: join(dir, ".env.example"),
        sources: [".env", ".env.production"],
        added: ["DB_URL", "PORT", "SENTRY_DSN"],
        created: true,
        written: true,
      });
      const written = readFileSync(join(dir, ".env.example"), "utf8");
      expect(written).toBe(lines("DB_URL=", "PORT=", "SENTRY_DSN="));
      expect(written).not.toContain("secret");
      expect(written).not.toContain("sk-live");
    });

    it("keeps an existing example as it is and appends only the missing keys", () => {
      createFile(dir, ".env.example", lines("# set by hand", "PORT=3000", "EXTRA=keep"));

      const summary = EnvExample.generate({ dir });

      expect(summary).toMatchObject({ added: ["DB_URL", "SENTRY_DSN"], created: false });
      expect(readFileSync(join(dir, ".env.example"), "utf8")).toBe(
        lines("# set by hand", "PORT=3000", "EXTRA=keep", "", "DB_URL=", "SENTRY_DSN=")
      );
    });

    it("leaves an up-to-date example untouched", () => {
      EnvExample.generate({ dir });

      const summary = EnvExample.generate({ dir });

      expect(summary).toMatchObject({ added: [], written: false, created: false });
    });

    it("never reads templates", () => {
      createFile(dir, ".env.sample", lines("FROM_SAMPLE=1"));
      createFile(dir, ".env.local.template", lines("FROM_TEMPLATE=1"));

      expect(EnvExample.generate({ dir }).added).not.toContain("FROM_SAMPLE");
      expect(EnvExample.generate({ dir, dryRun: true }).sources).toEqual([
        ".env",
        ".env.production",
      ]);
    });

    it("writes nothing for a dry run", () => {
      const summary = EnvExample.generate({ dir, dryRun: true });

      expect(summary.written).toBe(false);
      expect(summary.content).toContain("DB_URL=");
      expect(existsSync(join(dir, ".env.example"))).toBe(false);
    });

    it("sorts the result when asked", () => {
      EnvExample.generate({ dir, sort: "all" });

      expect(readFileSync(join(dir, ".env.example"), "utf8")).toBe(
        lines("DB_URL=", "PORT=", "SENTRY_DSN=")
      );
      createFile(dir, ".env.test", lines("AAA=1"));
      EnvExample.generate({ dir, sort: "all" });
      expect(EnvFile.keys(readFileSync(join(dir, ".env.example"), "utf8"))).toEqual([
        "AAA",
        "DB_URL",
        "PORT",
        "SENTRY_DSN",
      ]);
    });

    it("writes to another file and does not read it as a source", () => {
      createFile(dir, ".env.dist", lines("STALE=1"));

      const summary = EnvExample.generate({ dir, out: ".env.dist" });

      expect(summary.path).toBe(join(dir, ".env.dist"));
      expect(summary.sources).toEqual([".env", ".env.production"]);
      expect(readFileSync(join(dir, ".env.dist"), "utf8")).toContain("STALE=1");
    });

    it("can write outside the directory", () => {
      const out = join(dir, "docs", "env.txt");
      mkdirSync(join(dir, "docs"));

      expect(EnvExample.generate({ dir, out }).path).toBe(out);
      expect(existsSync(out)).toBe(true);
    });

    it("fails when there is nothing but templates", () => {
      rmSync(join(dir, ".env"));
      rmSync(join(dir, ".env.production"));
      createFile(dir, ".env.example", lines("A="));

      expect(() => EnvExample.generate({ dir })).toThrow(/No \.env files to read/);
    });

    it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
      "reports a source it cannot read",
      () => {
        chmodSync(join(dir, ".env"), 0o000);

        expect(() => EnvExample.generate({ dir })).toThrow(DotfileError);
      }
    );
  });
});

describe("EnvExample.build", () => {
  it("takes the keys in the order they first appear", () => {
    const built = EnvExample.build([
      { name: ".env", content: lines("B=1", "A=2") },
      { name: ".env.test", content: lines("C=1", "A=9") },
    ]);

    expect(built).toEqual({ content: lines("B=", "A=", "C="), added: ["B", "A", "C"] });
  });

  it("never copies a line above a key that is not a comment, nor a comment with '='", () => {
    const content = lines(
      "# Stripe",
      "STRIPE_KEY: sk_live_COLON",
      "# old: TOKEN=sk-old",
      "sk-live-STRAY",
      "OTHER=1",
      "",
      "ghp_STRAY_AFTER_BLANK",
      "LAST=1"
    );

    const built = EnvExample.build([{ name: ".env", content }]);

    expect(built.content).toBe(lines("STRIPE_KEY=", "OTHER=", "LAST="));
    expect(built.content).not.toMatch(/sk_|sk-|ghp_/);

    const kept = EnvExample.build([{ name: ".env", content }], undefined, { keepComments: true });
    expect(kept.content).toBe(lines("# Stripe", "STRIPE_KEY=", "OTHER=", "LAST="));
    expect(kept.content).not.toMatch(/sk_|sk-|ghp_/);
  });

  it("never copies the inside of a multi-line value, even a line that looks like a header", () => {
    const content = lines(
      "Z='first",
      "it\\'s still a value",
      "## --- sk_live_SECRET",
      "FAKE=value",
      "end'",
      "A=1"
    );

    const built = EnvExample.build([{ name: ".env", content }]);

    expect(built).toEqual({ content: lines("Z=", "A="), added: ["Z", "A"] });
  });

  it("copies only section headers by default, every comment with keepComments", () => {
    const content = lines("## --- Stripe", "# token: sk_live_NO_EQUALS", "STRIPE_KEY=sk", "B=1");

    expect(EnvExample.build([{ name: ".env", content }]).content).toBe(
      lines("## --- Stripe", "STRIPE_KEY=", "B=")
    );
    expect(
      EnvExample.build([{ name: ".env", content }], undefined, { keepComments: true }).content
    ).toBe(lines("## --- Stripe", "# token: sk_live_NO_EQUALS", "STRIPE_KEY=", "B="));
  });

  it("keeps the existing example byte for byte and appends in its line ending", () => {
    const existing = "A=\r\nB=placeholder   \r\n";

    const built = EnvExample.build([{ name: ".env", content: lines("A=1", "C=3") }], existing);

    expect(built.content).toBe(`${existing}\r\nC=\r\n`);
    expect(EnvExample.build([{ name: ".env", content: lines("C=3") }], "A=x").content).toBe(
      "A=x\n\nC=\n"
    );
  });

  it("replaces a blank existing example", () => {
    expect(EnvExample.build([{ name: ".env", content: lines("A=1") }], "\n").content).toBe(
      lines("A=")
    );
  });

  it("drops the value of a multi-line entry", () => {
    expect(EnvExample.build([{ name: ".env", content: lines('KEY="a', 'b"') }]).content).toBe(
      lines("KEY=")
    );
  });
});

describe("EnvExample.isTemplate", () => {
  it("knows the template names and suffixes", () => {
    for (const name of [".env.example", ".env.sample", ".env.template", ".env.local.example"]) {
      expect(EnvExample.isTemplate(name)).toBe(true);
    }
    for (const name of [".env", ".env.production", ".env.examples"]) {
      expect(EnvExample.isTemplate(name)).toBe(false);
    }
  });
});

describe("Reporter", () => {
  const base = { path: "/p/.env.example", sources: [".env", ".env.dev"], content: "" };

  it("describes what env-example did", () => {
    expect(
      Reporter.envExampleSummary({
        ...base,
        added: ["A", "B"],
        created: true,
        changed: true,
        written: true,
      })
    ).toBe("Created /p/.env.example from .env, .env.dev: 2 keys added.\n  + A\n  + B");
    expect(
      Reporter.envExampleSummary({
        ...base,
        added: ["A"],
        created: false,
        changed: true,
        written: true,
      })
    ).toBe("Updated /p/.env.example from .env, .env.dev: 1 key added.\n  + A");
    expect(
      Reporter.envExampleSummary({
        ...base,
        added: ["A"],
        created: true,
        changed: true,
        written: false,
      })
    ).toContain("Would have created /p/.env.example");
    expect(
      Reporter.envExampleSummary({
        ...base,
        added: [],
        created: false,
        changed: true,
        written: true,
      })
    ).toBe("Updated /p/.env.example from .env, .env.dev: no keys missing, order changed.");
    expect(
      Reporter.envExampleSummary({
        ...base,
        added: [],
        created: false,
        changed: false,
        written: false,
      })
    ).toBe("/p/.env.example is up to date: no keys missing from .env, .env.dev.");
  });

  it("describes what env-sort did", () => {
    const summary = { mode: "section" as const, changed: ["/p/.env"], unchanged: ["/p/.env.test"] };

    expect(Reporter.envSortSummary({ ...summary, check: false })).toBe(
      "  [SORTED] /p/.env\n  [OK] /p/.env.test\nSorted 1 file (--mode section), 1 already sorted."
    );
    expect(Reporter.envSortSummary({ ...summary, check: true })).toBe(
      "  [UNSORTED] /p/.env\n  [OK] /p/.env.test\n1 file not sorted (--mode section)."
    );
  });
});

describe("EnvFile.sortFiles with a file that cannot be written", () => {
  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "reports it as a DotfileError",
    () => {
      const dir = makeTempDir("dotfiles-env-ro-");
      try {
        writeFileSync(join(dir, ".env"), lines("B=1", "A=2"));
        chmodSync(join(dir, ".env"), 0o444);

        expect(() => EnvFile.sortFiles({ dir })).toThrow(/^Cannot write .*(EACCES|EPERM)/);
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  );
});
