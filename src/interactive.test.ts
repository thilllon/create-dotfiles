import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DotfileError } from "./errors";
import {
  CANCEL,
  type Cancelled,
  type ConfirmPrompt,
  type InteractiveOptions,
  type MultiselectPrompt,
  type Prompter,
  runInteractive,
} from "./interactive";
import { createFile, FIXED_DATE, FIXED_NAME, makeTempDir, TEST_PLATFORM } from "./test-helpers";

interface Script {
  confirm?: (boolean | Cancelled)[];
  multiselect?: (string[] | Cancelled)[];
}

/** Records every prompt in order and answers from a script; never touches a terminal. */
class FakePrompter implements Prompter {
  readonly events: string[] = [];
  readonly notes: { title: string; message: string }[] = [];
  readonly confirms: ConfirmPrompt[] = [];
  readonly multiselects: MultiselectPrompt<string>[] = [];
  readonly spinnerLog: string[] = [];
  introTitle?: string;
  outroMessage?: string;
  cancelMessage?: string;

  constructor(private readonly script: Script = {}) {}

  intro(title: string): void {
    this.introTitle = title;
    this.events.push("intro");
  }

  outro(message: string): void {
    this.outroMessage = message;
    this.events.push("outro");
  }

  cancel(message: string): void {
    this.cancelMessage = message;
    this.events.push("cancel");
  }

  note(message: string, title: string): void {
    this.notes.push({ title, message });
    this.events.push(`note:${title}`);
  }

  async confirm(prompt: ConfirmPrompt): Promise<boolean | Cancelled> {
    this.confirms.push(prompt);
    this.events.push(`confirm:${prompt.message}`);
    const answer = this.script.confirm?.shift();
    if (answer === undefined) throw new Error(`unscripted confirm: ${prompt.message}`);
    return answer;
  }

  async multiselect<T extends string>(prompt: MultiselectPrompt<T>): Promise<T[] | Cancelled> {
    this.multiselects.push(prompt as MultiselectPrompt<string>);
    this.events.push(`multiselect:${prompt.message}`);
    const answer = this.script.multiselect?.shift();
    if (answer === undefined) throw new Error(`unscripted multiselect: ${prompt.message}`);
    return answer as T[] | Cancelled;
  }

  spinner() {
    const log = this.spinnerLog;
    return {
      start: (message: string) => void log.push(`start:${message}`),
      message: (message: string) => void log.push(`message:${message}`),
      stop: (message: string) => void log.push(`stop:${message}`),
    };
  }
}

describe("runInteractive", () => {
  let home: string;
  let out: string;

  beforeEach(() => {
    home = makeTempDir();
    out = join(home, "out");
    createFile(home, ".zshrc", "export ZSH=1");
    createFile(home, ".gitconfig", "[user]");
    createFile(home, ".config/nvim/init.lua", "-- vim");
    createFile(home, ".npmrc", "token");
    createFile(home, "projects/app/.env", "A=1");
    createFile(home, "projects/app/.env.local", "B=2");
    createFile(home, ".config/tool/config.toml", "x".repeat(2048));
    createFile(home, ".config/tool/Cache/blob", "cached");
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  const run = (prompter: Prompter, options: InteractiveOptions = {}) =>
    runInteractive(prompter, {
      homeDir: home,
      outDir: out,
      now: FIXED_DATE,
      platform: TEST_PLATFORM,
      ...options,
    });

  const accept = (script: Script = {}) =>
    new FakePrompter({
      confirm: script.confirm ?? [false, false, true],
      multiselect: script.multiselect ?? [["folder"]],
    });

  it("asks the questions in order, quoting counts from the scan", async () => {
    const prompter = accept();

    await run(prompter);

    expect(prompter.introTitle).toBe("create-dotfiles");
    expect(prompter.events.slice(0, 4)).toEqual([
      "intro",
      "note:Found on this machine",
      "note:Never copied",
      "confirm:Include secret files? (.env files found by scan: 2, plus .npmrc/.netrc/.aws/credentials/.docker/config.json)",
    ]);
    expect(prompter.confirms.map((c) => c.message)).toEqual([
      "Include secret files? (.env files found by scan: 2, plus .npmrc/.netrc/.aws/credentials/.docker/config.json)",
      "Include everything under ~/.config? (1 files, ~0.0 MB after excludes)",
      "Proceed?",
    ]);
    expect(prompter.confirms.map((c) => c.initialValue)).toEqual([true, false, true]);
    expect(prompter.multiselects).toEqual([
      {
        message: "Output formats",
        options: [
          { value: "folder", label: "folder", hint: "dotfiles-YYYYMMDD-HHMMSS/" },
          { value: "zip", label: "zip", hint: "dotfiles-YYYYMMDD-HHMMSS.zip" },
          { value: "tar", label: "tar.gz", hint: "dotfiles-YYYYMMDD-HHMMSS.tar.gz" },
        ],
        initialValues: ["folder"],
        required: true,
      },
    ]);
    expect(prompter.events.indexOf("note:Output")).toBeLessThan(
      prompter.events.indexOf("confirm:Proceed?")
    );
  });

  it("lists the core targets found on this machine and the never-copied rules", async () => {
    const prompter = accept();

    await run(prompter);

    const found = prompter.notes.find((n) => n.title === "Found on this machine");
    expect(found?.message).toContain("Shell: .zshrc");
    expect(found?.message).toContain("Git: .gitconfig");
    expect(found?.message).toContain("Editors: .config/nvim");
    expect(found?.message).not.toContain(".npmrc");
    const never = prompter.notes.find((n) => n.title === "Never copied");
    expect(never?.message).toContain("node_modules");
    expect(never?.message).toContain("SSH private keys");
    expect(never?.message).toContain("larger than 10 MB");
    expect(never?.message).toContain("never enters ~/Library, ~/Desktop, ~/Documents");
  });

  it("collects only the core group into a folder with the default answers", async () => {
    const prompter = accept();

    const result = await run(prompter);

    expect(result.cancelled).toBe(false);
    if (result.cancelled) return;
    expect(result.summary.counts).toEqual({ core: 3, secrets: 0, "config-all": 0, custom: 0 });
    expect(readdirSync(out)).toEqual([FIXED_NAME]);
    expect(readFileSync(join(out, FIXED_NAME, ".zshrc"), "utf8")).toBe("export ZSH=1");
    expect(existsSync(join(out, FIXED_NAME, ".npmrc"))).toBe(false);
    expect(prompter.spinnerLog).toContain("start:Collecting dotfiles");
    expect(prompter.spinnerLog).toContain("message:Copying 1/3: .zshrc");
    expect(prompter.spinnerLog.at(-1)).toBe("stop:Collected 3 files (24 B)");
    expect(prompter.notes.at(-1)?.title).toBe("Summary");
    expect(prompter.outroMessage).toBe(`Done: ${join(out, FIXED_NAME)}`);
  });

  it("respects Yes answers and the chosen formats", async () => {
    const prompter = accept({ confirm: [true, true, true], multiselect: [["zip", "tar"]] });

    const result = await run(prompter);

    expect(result.cancelled).toBe(false);
    if (result.cancelled) return;
    expect(result.summary.counts).toEqual({ core: 3, secrets: 3, "config-all": 1, custom: 0 });
    expect(readdirSync(out).sort()).toEqual([`${FIXED_NAME}.tar.gz`, `${FIXED_NAME}.zip`]);
    const names = Object.keys(unzipSync(readFileSync(join(out, `${FIXED_NAME}.zip`))));
    expect(names).toContain(`${FIXED_NAME}/.npmrc`);
    expect(names).toContain(`${FIXED_NAME}/projects/app/.env`);
    expect(names).toContain(`${FIXED_NAME}/.config/tool/config.toml`);
    expect(names).not.toContain(`${FIXED_NAME}/.config/tool/Cache/blob`);
    expect(prompter.outroMessage).toBe(
      `Done: ${join(out, `${FIXED_NAME}.zip`)}, ${join(out, `${FIXED_NAME}.tar.gz`)}`
    );
  });

  it("pre-fills the prompts from flags and config settings, but the answers decide", async () => {
    createFile(
      home,
      ".dotfilesrc.toml",
      '[settings]\ninclude_config = true\nformats = ["zip", "tar"]'
    );
    const prompter = accept({ confirm: [false, false, true], multiselect: [["folder"]] });

    const result = await run(prompter, { includeEnv: true, maxFileSizeMb: 3 });

    expect(prompter.confirms.map((c) => c.initialValue)).toEqual([true, true, true]);
    expect(prompter.multiselects[0].initialValues).toEqual(["zip", "tar"]);
    expect(prompter.notes[1].message).toContain("larger than 3 MB");
    expect(result.cancelled).toBe(false);
    if (result.cancelled) return;
    expect(result.summary.counts).toEqual({ core: 3, secrets: 0, "config-all": 0, custom: 0 });
    expect(result.summary.formats).toEqual(["folder"]);
    expect(readdirSync(out)).toEqual([FIXED_NAME]);
    expect(existsSync(join(out, FIXED_NAME, ".npmrc"))).toBe(false);
    expect(existsSync(join(out, FIXED_NAME, ".config/tool/config.toml"))).toBe(false);
  });

  it("shows the output paths and file count before the final confirm", async () => {
    const prompter = accept({ confirm: [false, false, true], multiselect: [["folder", "zip"]] });

    await run(prompter);

    const output = prompter.notes.find((n) => n.title === "Output");
    expect(output?.message).toContain("3 files, 24 B");
    expect(output?.message).toContain(`folder: ${join(out, FIXED_NAME)}/`);
    expect(output?.message).toContain(`zip:    ${join(out, `${FIXED_NAME}.zip`)}`);
    expect(output?.message).not.toContain("tar.gz:");
  });

  it("mentions files over the size cap in the output preview", async () => {
    createFile(home, ".vimrc", Buffer.alloc(1024 * 1024 + 1));
    const prompter = accept();

    await run(prompter, { maxFileSizeMb: 1 });

    expect(prompter.notes.find((n) => n.title === "Output")?.message).toContain(
      "1 file(s) over 1 MB will be skipped"
    );
  });

  it.each([
    ["the secrets question", { confirm: [CANCEL], multiselect: [] }],
    ["the ~/.config question", { confirm: [false, CANCEL], multiselect: [] }],
    ["the formats question", { confirm: [false, false], multiselect: [CANCEL] }],
    ["the final confirm", { confirm: [false, false, CANCEL], multiselect: [["folder"]] }],
  ] as [string, Script][])(
    "cancelling at %s writes nothing and exits cleanly",
    async (_step, script) => {
      const before = readdirSync(home).sort();
      const prompter = new FakePrompter(script);

      const result = await run(prompter);

      expect(result).toEqual({ cancelled: true });
      expect(prompter.cancelMessage).toBe("Cancelled.");
      expect(prompter.outroMessage).toBeUndefined();
      expect(prompter.spinnerLog.some((l) => l.startsWith("start:Collecting"))).toBe(false);
      expect(existsSync(out)).toBe(false);
      expect(readdirSync(home).sort()).toEqual(before);
    }
  );

  it("answering No to the final confirm is a cancel", async () => {
    const prompter = accept({ confirm: [true, true, false] });

    const result = await run(prompter);

    expect(result).toEqual({ cancelled: true });
    expect(prompter.cancelMessage).toBe("Cancelled.");
    expect(existsSync(out)).toBe(false);
  });

  it("re-asks once per empty formats answer, with a note in between, then uses the answer", async () => {
    const prompter = accept({ multiselect: [[], ["tar"]] });

    const result = await run(prompter);

    const first = prompter.events.indexOf("multiselect:Output formats");
    expect(prompter.events.slice(first, first + 4)).toEqual([
      "multiselect:Output formats",
      "note:Output formats",
      "multiselect:Output formats",
      "note:Output",
    ]);
    expect(prompter.notes.filter((n) => n.title === "Output formats")).toEqual([
      { title: "Output formats", message: "Select at least one output format." },
    ]);
    expect(result.cancelled).toBe(false);
    if (result.cancelled) return;
    expect(result.summary.formats).toEqual(["tar"]);
    expect(readdirSync(out)).toEqual([`${FIXED_NAME}.tar.gz`]);
  });

  it("in a dry run shows the plan after the final confirm and writes nothing", async () => {
    const prompter = accept({ confirm: [true, false, true] });

    const result = await run(prompter, { dryRun: true });

    expect(result.cancelled).toBe(false);
    if (result.cancelled) return;
    expect(result.summary.dryRun).toBe(true);
    expect(existsSync(out)).toBe(false);
    const dry = prompter.notes.find((n) => n.title === "Dry run");
    expect(dry?.message).toContain("Would copy 6 files");
    expect(dry?.message).toContain("  .npmrc (5 B) [secrets]");
    expect(prompter.outroMessage).toBe("Dry run: nothing was written.");
    expect(prompter.spinnerLog.some((l) => l.startsWith("start:Collecting"))).toBe(false);
  });

  it("stops the spinner and rethrows when writing fails", async () => {
    mkdirSync(join(out, FIXED_NAME), { recursive: true });
    const prompter = accept();

    await expect(run(prompter)).rejects.toThrow(DotfileError);

    expect(prompter.spinnerLog.at(-1)).toBe("stop:Collection failed");
    expect(prompter.outroMessage).toBeUndefined();
  });

  it("reports when no default targets exist", async () => {
    const empty = makeTempDir();
    const prompter = accept();
    try {
      await runInteractive(prompter, { homeDir: empty, now: FIXED_DATE, platform: TEST_PLATFORM });

      expect(prompter.notes[0].message).toMatch(/No dotfiles .* found/);
      expect(prompter.confirms[0].message).toContain(".env files found by scan: 0");
      expect(prompter.confirms[1].message).toContain("(0 files, ~0.0 MB after excludes)");
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });
});
