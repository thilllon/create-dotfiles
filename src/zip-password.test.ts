import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DotfileError } from "./errors";
import { makeTempDir } from "./test-helpers";
import {
  assertZipPassword,
  generateZipPassword,
  MAX_ZIP_PASSWORD_LENGTH,
  MIN_ZIP_PASSWORD_LENGTH,
  requireZipPasswordFromEnv,
  ZIP_PASSWORD_ENV,
  ZIP_PASSWORD_FILE_ENV,
  zipPasswordFromEnv,
  zipPasswordProblem,
} from "./zip-password";

describe("zipPasswordProblem", () => {
  it("accepts printable ASCII from 15 to 99 characters, spaces included", () => {
    expect(zipPasswordProblem("a".repeat(MIN_ZIP_PASSWORD_LENGTH))).toBeUndefined();
    expect(zipPasswordProblem("a".repeat(MAX_ZIP_PASSWORD_LENGTH))).toBeUndefined();
    expect(zipPasswordProblem("correct horse battery staple")).toBeUndefined();
    expect(zipPasswordProblem(" !\"#$%&'()*+,-./0123456789:;<=>?@[\\]^_`{|}~")).toBeUndefined();
  });

  it.each([
    ["", "at least 15 characters (got 0)"],
    ["a".repeat(14), "at least 15 characters (got 14)"],
    ["a".repeat(100), "at most 99 characters, the most 7-Zip accepts (got 100)"],
    ["pässwörd mit umlauten", "only printable ASCII"],
    ["tab\tseparated password", "only printable ASCII"],
    ["delete\x7fcharacter password", "only printable ASCII"],
    ["line one\nline two password", "only printable ASCII"],
  ])("rejects %j", (password, message) => {
    expect(zipPasswordProblem(password)).toContain(message);
    expect(() => assertZipPassword(password)).toThrow(DotfileError);
  });
});

describe("generateZipPassword", () => {
  it("makes six groups of five Crockford base32 symbols that pass the policy", () => {
    const password = generateZipPassword();

    expect(password).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){5}$/);
    expect(zipPasswordProblem(password)).toBeUndefined();
  });

  it("does not repeat itself", () => {
    const passwords = new Set(Array.from({ length: 200 }, () => generateZipPassword()));

    expect(passwords.size).toBe(200);
  });
});

describe("zipPasswordFromEnv", () => {
  let dir: string;

  beforeEach(() => {
    dir = makeTempDir("dotfiles-zip-password-");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("returns undefined when neither variable is set, or both are empty", () => {
    expect(zipPasswordFromEnv({})).toBeUndefined();
    expect(
      zipPasswordFromEnv({ [ZIP_PASSWORD_ENV]: "", [ZIP_PASSWORD_FILE_ENV]: "" })
    ).toBeUndefined();
  });

  it("reads the password variable as given", () => {
    expect(zipPasswordFromEnv({ [ZIP_PASSWORD_ENV]: " spaced password " })).toBe(
      " spaced password "
    );
  });

  it.each([
    ["LF", "from a file password\nsecond line\n"],
    ["CRLF", "from a file password\r\nsecond line"],
    ["no newline", "from a file password"],
    ["a UTF-8 BOM", "\uFEFFfrom a file password\r\n"],
  ])("reads the first line of the password file (%s)", (_, content) => {
    const file = join(dir, "password");
    writeFileSync(file, content);

    expect(zipPasswordFromEnv({ [ZIP_PASSWORD_FILE_ENV]: file })).toBe("from a file password");
  });

  it("keeps leading and trailing spaces in the password file", () => {
    const file = join(dir, "password");
    writeFileSync(file, "  spaced out password  \n");

    expect(zipPasswordFromEnv({ [ZIP_PASSWORD_FILE_ENV]: file })).toBe("  spaced out password  ");
  });

  it("refuses both variables at once", () => {
    expect(() =>
      zipPasswordFromEnv({ [ZIP_PASSWORD_ENV]: "a", [ZIP_PASSWORD_FILE_ENV]: join(dir, "p") })
    ).toThrow(`Set only one of ${ZIP_PASSWORD_ENV} and ${ZIP_PASSWORD_FILE_ENV}`);
  });

  it("reports a password file that cannot be read or starts with an empty line", () => {
    const missing = join(dir, "missing");
    expect(() => zipPasswordFromEnv({ [ZIP_PASSWORD_FILE_ENV]: missing })).toThrow(
      `Cannot read ${ZIP_PASSWORD_FILE_ENV} (${missing})`
    );

    const empty = join(dir, "empty");
    writeFileSync(empty, "\nsecond line");
    expect(() => zipPasswordFromEnv({ [ZIP_PASSWORD_FILE_ENV]: empty })).toThrow(
      "has no password on its first line"
    );
  });
});

describe("requireZipPasswordFromEnv", () => {
  it("returns the password, or explains where one can come from", () => {
    expect(requireZipPasswordFromEnv({ [ZIP_PASSWORD_ENV]: "x" })).toBe("x");
    expect(() => requireZipPasswordFromEnv({})).toThrow(
      `set ${ZIP_PASSWORD_ENV} or ${ZIP_PASSWORD_FILE_ENV}, or run interactively in a terminal`
    );
  });
});
