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
  type PasswordPrompt,
  type Prompter,
  runInteractive,
} from "./interactive";
import { readAesZip } from "./test-aes-zip";
import { createFile, FIXED_DATE, FIXED_NAME, makeTempDir, TEST_PLATFORM } from "./test-helpers";

interface Script {
  confirm?: (boolean | Cancelled)[];
  multiselect?: (string[] | Cancelled)[];
  /** Entries typed at password prompts; one the prompt's validator rejects is typed over. */
  password?: (string | Cancelled)[];
}

/** Records every prompt in order and answers from a script; never touches a terminal. */
class FakePrompter implements Prompter {
  readonly events: string[] = [];
  readonly notes: { title: string; message: string }[] = [];
  readonly confirms: ConfirmPrompt[] = [];
  readonly multiselects: MultiselectPrompt<string>[] = [];
  readonly passwords: PasswordPrompt[] = [];
  /** What each password prompt's validator said about rejected entries, in order. */
  readonly passwordRejections: string[] = [];
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

  /** Like clack: an entry the validator rejects is asked for again, from the next scripted one. */
  async password(prompt: PasswordPrompt): Promise<string | Cancelled> {
    this.passwords.push(prompt);
    this.events.push(`password:${prompt.message}`);
    for (;;) {
      const answer = this.script.password?.shift();
      if (answer === undefined) throw new Error(`unscripted password: ${prompt.message}`);
      if (answer === CANCEL) return answer;
      const problem = prompt.validate?.(answer);
      if (problem === undefined) return answer;
      this.passwordRejections.push(problem);
    }
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
      password: script.password ?? [],
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
    const prompter = accept({ confirm: [true, true, false, true], multiselect: [["zip", "tar"]] });

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
    const prompter = accept({
      confirm: [false, false, false, true],
      multiselect: [["folder", "zip"]],
    });

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

  describe("zip encryption", () => {
    const PASSWORD = "correct horse battery staple";
    const PROTECT = "Protect the zip with a password? (AES-256)";
    const zipPath = () => join(out, `${FIXED_NAME}.zip`);

    it("asks about protection only when a zip is chosen, defaulting to No", async () => {
      const folderOnly = accept();
      await run(folderOnly);
      expect(folderOnly.confirms.map((c) => c.message)).not.toContain(PROTECT);

      rmSync(out, { recursive: true, force: true });
      const zipped = accept({ confirm: [false, false, false, true], multiselect: [["zip"]] });
      await run(zipped);
      expect(zipped.confirms.find((c) => c.message === PROTECT)?.initialValue).toBe(false);
      expect(zipped.passwords).toEqual([]);
      expect(Object.keys(unzipSync(readFileSync(zipPath())))).toContain(`${FIXED_NAME}/.zshrc`);
    });

    it("encrypts with a password typed twice and says so before and after writing", async () => {
      const prompter = accept({
        confirm: [true, false, true, true],
        multiselect: [["folder", "zip"]],
        password: [PASSWORD, PASSWORD],
      });

      const result = await run(prompter);

      expect(result.cancelled).toBe(false);
      expect(prompter.passwords.map((p) => p.message)).toEqual([
        "Zip password (at least 15 characters; leave empty to generate one)",
        "Repeat the zip password",
      ]);
      const entries = readAesZip(readFileSync(zipPath()), PASSWORD);
      expect(entries.map((e) => e.name)).toContain(`${FIXED_NAME}/.npmrc`);
      const output = prompter.notes.find((n) => n.title === "Output")?.message;
      expect(output).toContain(`zip:    ${zipPath()} (AES-256, password-protected)`);
      expect(output).toContain("Only the zip is encrypted: the folder is not.");
      expect(prompter.notes.find((n) => n.title === "Summary")?.message).toContain(
        "(AES-256, password-protected)"
      );
    });

    it("asks again for a password that is too short or not ASCII", async () => {
      const prompter = accept({
        confirm: [false, false, true, true],
        multiselect: [["zip"]],
        password: ["too short", "pässwörd with umlauts", PASSWORD, PASSWORD],
      });

      await run(prompter);

      expect(prompter.passwordRejections).toEqual([
        "The zip password must be at least 15 characters (got 9)",
        "The zip password may contain only printable ASCII: letters, digits, punctuation and spaces (7-Zip rejects other characters)",
      ]);
      expect(readAesZip(readFileSync(zipPath()), PASSWORD)).toHaveLength(3);
    });

    it("starts over when the repeated password does not match, so a typo in the first can be fixed", async () => {
      const typo = "correct horse battery stapel";
      const prompter = accept({
        confirm: [false, false, true, true],
        multiselect: [["zip"]],
        password: [typo, PASSWORD, PASSWORD, PASSWORD],
      });

      await run(prompter);

      expect(prompter.passwords.map((p) => p.message)).toEqual([
        "Zip password (at least 15 characters; leave empty to generate one)",
        "Repeat the zip password",
        "Zip password (at least 15 characters; leave empty to generate one)",
        "Repeat the zip password",
      ]);
      expect(prompter.notes).toContainEqual({
        title: "Zip password",
        message: "The passwords do not match. Enter the password again.",
      });
      expect(readAesZip(readFileSync(zipPath()), PASSWORD)).toHaveLength(3);
      expect(() => readAesZip(readFileSync(zipPath()), typo)).toThrow();
    });

    it("needs zipPassword when the prompter has no password prompt", async () => {
      const prompter = accept({ confirm: [false, false, true], multiselect: [["zip"]] });
      // A prompter written before password prompts existed.
      const withoutPassword: Prompter = {
        intro: (title) => prompter.intro(title),
        outro: (message) => prompter.outro(message),
        cancel: (message) => prompter.cancel(message),
        note: (message, title) => prompter.note(message, title),
        confirm: (prompt) => prompter.confirm(prompt),
        multiselect: (prompt) => prompter.multiselect(prompt),
        spinner: () => prompter.spinner(),
      };

      await expect(run(withoutPassword)).rejects.toThrow(
        "This prompter cannot ask for a password: pass zipPassword to encrypt the zip"
      );
      expect(existsSync(out)).toBe(false);
    });

    it("generates a password when the entry is left empty and shows it once", async () => {
      const prompter = accept({
        confirm: [false, false, true, true, true],
        multiselect: [["zip"]],
        password: [""],
      });

      await run(prompter);

      const note = prompter.notes.find((n) => n.title === "Generated zip password");
      const generated = note?.message.split("\n")[0] ?? "";
      expect(generated).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){5}$/);
      expect(note?.message).toContain("Store it in a password manager now");
      expect(note?.message).toContain("The entry was left empty, so this password was generated.");
      expect(prompter.confirms.find((c) => c.message.startsWith("Have you stored it?"))).toEqual({
        message: "Have you stored it? (No to type your own password instead)",
        initialValue: false,
      });
      expect(prompter.passwords).toHaveLength(1);
      expect(readAesZip(readFileSync(zipPath()), generated)).toHaveLength(3);
    });

    it("goes back to the entry when the generated password was not stored", async () => {
      // "y" submits clack's confirm on its own, so an Enter typed after it arrives here as an
      // empty entry: a user who answers No must still get to type their own password.
      const prompter = accept({
        confirm: [false, false, true, false, true],
        multiselect: [["zip"]],
        password: ["", PASSWORD, PASSWORD],
      });

      await run(prompter);

      expect(prompter.notes.filter((n) => n.title === "Generated zip password")).toHaveLength(1);
      expect(prompter.passwords.map((p) => p.message)).toEqual([
        "Zip password (at least 15 characters; leave empty to generate one)",
        "Zip password (at least 15 characters; leave empty to generate one)",
        "Repeat the zip password",
      ]);
      expect(readAesZip(readFileSync(zipPath()), PASSWORD)).toHaveLength(3);
    });

    it("uses a supplied password without asking, and rejects a weak one", async () => {
      const prompter = accept({ confirm: [false, false, true, true], multiselect: [["zip"]] });

      await run(prompter, { zipPassword: () => PASSWORD });

      expect(prompter.passwords).toEqual([]);
      expect(prompter.notes.map((n) => n.title)).toContain("Zip password");
      expect(readAesZip(readFileSync(zipPath()), PASSWORD)).toHaveLength(3);

      const weak = accept({ confirm: [false, false, true], multiselect: [["zip"]] });
      await expect(run(weak, { zipPassword: "weak" })).rejects.toThrow("at least 15 characters");
    });

    it("pre-fills protection from the option or encrypt_zip, even when the default format is folder", async () => {
      createFile(home, ".dotfilesrc.toml", "[settings]\nencrypt_zip = true");
      const fromConfig = accept({ confirm: [false, false, false, true], multiselect: [["zip"]] });
      await run(fromConfig);
      expect(fromConfig.confirms.find((c) => c.message === PROTECT)?.initialValue).toBe(true);

      rmSync(out, { recursive: true, force: true });
      const fromOption = accept({ confirm: [false, false, false, true], multiselect: [["zip"]] });
      await run(fromOption, {
        encryptZip: true,
        config: { include: [], exclude: [], settings: {} },
      });
      expect(fromOption.confirms.find((c) => c.message === PROTECT)?.initialValue).toBe(true);
      // Answering No wins over the default.
      expect(Object.keys(unzipSync(readFileSync(zipPath())))).toContain(`${FIXED_NAME}/.zshrc`);
    });

    it("does not ask for a password in a dry run", async () => {
      const prompter = accept({ confirm: [false, false, true, true], multiselect: [["zip"]] });

      const result = await run(prompter, { dryRun: true });

      expect(prompter.passwords).toEqual([]);
      expect(result.cancelled).toBe(false);
      expect(prompter.notes.find((n) => n.title === "Dry run")?.message).toContain(
        "(AES-256, password-protected)"
      );
      expect(existsSync(out)).toBe(false);
    });

    it.each([
      ["the protection question", { confirm: [false, false, CANCEL], multiselect: [["zip"]] }],
      [
        "the password",
        { confirm: [false, false, true], multiselect: [["zip"]], password: [CANCEL] },
      ],
      [
        "the repeated password",
        { confirm: [false, false, true], multiselect: [["zip"]], password: [PASSWORD, CANCEL] },
      ],
      [
        "the stored-password question",
        { confirm: [false, false, true, CANCEL], multiselect: [["zip"]], password: [""] },
      ],
    ] as [string, Script][])("cancelling at %s writes nothing", async (_step, script) => {
      const prompter = new FakePrompter(script);

      const result = await run(prompter);

      expect(result).toEqual({ cancelled: true });
      expect(prompter.cancelMessage).toBe("Cancelled.");
      expect(existsSync(out)).toBe(false);
    });
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
