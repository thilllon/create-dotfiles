import { randomInt } from "node:crypto";
import { readFileSync } from "node:fs";
import { DotfileError } from "./errors";

/**
 * The zip is encrypted with WinZip AES-256, whose key derivation is fixed by the format at
 * PBKDF2-HMAC-SHA1 with 1000 iterations: a single GPU tries tens of millions of passwords a
 * second. The password is therefore the whole defence. 15 is the NIST SP 800-63B-4 minimum
 * for a password that is the only factor.
 */
export const MIN_ZIP_PASSWORD_LENGTH = 15;

/** 7-Zip refuses longer passwords, so a longer one would make the zip impossible to open there. */
export const MAX_ZIP_PASSWORD_LENGTH = 99;

/** Scripted runs read the password from one of these; it is never taken from argv. */
export const ZIP_PASSWORD_ENV = "CREATE_DOTFILES_ZIP_PASSWORD";
export const ZIP_PASSWORD_FILE_ENV = "CREATE_DOTFILES_ZIP_PASSWORD_FILE";

/**
 * A password, or a function that is called only when the zip is actually encrypted and
 * returns `undefined` when it has none to give (the interactive flow then asks for one).
 */
export type ZipPasswordSource = string | (() => string | undefined);

/**
 * Why `password` cannot protect the zip, or `undefined` when it can. Only printable ASCII is
 * accepted because 7-Zip (p7zip in particular) rejects anything else, which would leave a zip
 * nobody can open with the most common tool.
 */
export function zipPasswordProblem(password: string): string | undefined {
  if (password.length < MIN_ZIP_PASSWORD_LENGTH) {
    return `The zip password must be at least ${MIN_ZIP_PASSWORD_LENGTH} characters (got ${password.length})`;
  }
  if (password.length > MAX_ZIP_PASSWORD_LENGTH) {
    return `The zip password must be at most ${MAX_ZIP_PASSWORD_LENGTH} characters, the most 7-Zip accepts (got ${password.length})`;
  }
  if (!/^[\x20-\x7e]+$/.test(password)) {
    return "The zip password may contain only printable ASCII: letters, digits, punctuation and spaces (7-Zip rejects other characters)";
  }
  return undefined;
}

export function assertZipPassword(password: string): void {
  const problem = zipPasswordProblem(password);
  if (problem !== undefined) throw new DotfileError(problem);
}

// Crockford's base32 alphabet: no I, L, O or U, so a password copied from paper or read aloud
// cannot be mistyped as a look-alike.
const GENERATED_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const GENERATED_GROUPS = 6;
const GENERATED_GROUP_LENGTH = 5;

/** 30 random symbols in six dash-separated groups of five: 150 bits, e.g. `7K2QM-4XH9T-...`. */
export function generateZipPassword(): string {
  const groups: string[] = [];
  for (let g = 0; g < GENERATED_GROUPS; g++) {
    let group = "";
    for (let i = 0; i < GENERATED_GROUP_LENGTH; i++) {
      group += GENERATED_ALPHABET[randomInt(GENERATED_ALPHABET.length)];
    }
    groups.push(group);
  }
  return groups.join("-");
}

/**
 * The password for a run without a terminal prompt: `$CREATE_DOTFILES_ZIP_PASSWORD`, or the
 * first line of the file named by `$CREATE_DOTFILES_ZIP_PASSWORD_FILE` (a leading UTF-8 BOM, as
 * Windows editors write, is dropped). An empty variable counts as unset. Returns `undefined`
 * when neither is set; setting both is an error.
 */
export function zipPasswordFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const direct = env[ZIP_PASSWORD_ENV] || undefined;
  const file = env[ZIP_PASSWORD_FILE_ENV] || undefined;
  if (direct !== undefined && file !== undefined) {
    throw new DotfileError(`Set only one of ${ZIP_PASSWORD_ENV} and ${ZIP_PASSWORD_FILE_ENV}`);
  }
  if (file === undefined) return direct;

  let content: string;
  try {
    content = readFileSync(file, "utf8");
  } catch (err) {
    throw new DotfileError(
      `Cannot read ${ZIP_PASSWORD_FILE_ENV} (${file}): ${(err as Error).message}`
    );
  }
  const [line = ""] = content.replace(/^\uFEFF/, "").split(/\r?\n/, 1);
  if (line === "") {
    throw new DotfileError(`${ZIP_PASSWORD_FILE_ENV} (${file}) has no password on its first line`);
  }
  return line;
}

/** {@link zipPasswordFromEnv} for runs that cannot prompt: no password is an error. */
export function requireZipPasswordFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const password = zipPasswordFromEnv(env);
  if (password === undefined) {
    throw new DotfileError(
      `Encrypting the zip needs a password: set ${ZIP_PASSWORD_ENV} or ${ZIP_PASSWORD_FILE_ENV}, or run interactively in a terminal to be asked for one`
    );
  }
  return password;
}
