import { posix, sep, win32 } from "node:path";
import { describe, expect, it } from "vitest";
import { archiveEntryName, isSamePath, normalizeSlashes, toPosixPath } from "./paths";

describe("toPosixPath", () => {
  it("converts a path with Windows separators to / on any host", () => {
    expect(toPosixPath("AppData\\Roaming\\Code\\User\\settings.json", win32.sep)).toBe(
      "AppData/Roaming/Code/User/settings.json"
    );
    expect(toPosixPath(win32.join(".config", "nvim", "init.lua"), win32.sep)).toBe(
      ".config/nvim/init.lua"
    );
    expect(toPosixPath(win32.relative("C:\\Users\\me", "C:\\Users\\me\\a\\b"), win32.sep)).toBe(
      "a/b"
    );
  });

  it("leaves a POSIX path alone", () => {
    expect(toPosixPath("a/b/c", posix.sep)).toBe("a/b/c");
    expect(toPosixPath(".zshrc", posix.sep)).toBe(".zshrc");
    expect(toPosixPath("", posix.sep)).toBe("");
  });

  it("defaults to the host separator", () => {
    expect(toPosixPath(["a", "b", "c"].join(sep))).toBe("a/b/c");
  });
});

describe("normalizeSlashes", () => {
  it("turns every backslash into a slash and leaves everything else", () => {
    expect(normalizeSlashes(".config\\app\\tmp\\")).toBe(".config/app/tmp/");
    expect(normalizeSlashes("mixed/style\\path")).toBe("mixed/style/path");
    expect(normalizeSlashes("already/posix")).toBe("already/posix");
    expect(normalizeSlashes("spaces dir\\ünï cödé.txt")).toBe("spaces dir/ünï cödé.txt");
  });
});

describe("archiveEntryName", () => {
  it("roots the entry at the collection name with / separators, even from a win32 path", () => {
    const name = "dotfiles-20260902-110342";
    expect(archiveEntryName(name, "AppData\\Roaming\\Code\\User\\settings.json", win32.sep)).toBe(
      `${name}/AppData/Roaming/Code/User/settings.json`
    );
    expect(archiveEntryName(name, ".zshrc", win32.sep)).toBe(`${name}/.zshrc`);
    expect(archiveEntryName(name, ".config/nvim/init.lua", posix.sep)).toBe(
      `${name}/.config/nvim/init.lua`
    );
  });

  it("never produces a backslash or an absolute name, which yazl and tar readers reject", () => {
    const names = [
      archiveEntryName("c", win32.join("a", "b", "c.txt"), win32.sep),
      archiveEntryName("c", posix.join("a", "b", "c.txt"), posix.sep),
    ];
    for (const entry of names) {
      expect(entry).toBe("c/a/b/c.txt");
      expect(entry).not.toContain("\\");
      expect(entry.startsWith("/")).toBe(false);
    }
  });
});

describe("isSamePath", () => {
  it("compares case-insensitively on win32 and exactly elsewhere", () => {
    expect(isSamePath("C:\\Users\\Me", "c:\\users\\me", "win32")).toBe(true);
    expect(isSamePath("C:\\Users\\Me", "C:\\Users\\You", "win32")).toBe(false);
    expect(isSamePath("/home/Me", "/home/me", "linux")).toBe(false);
    expect(isSamePath("/home/me", "/home/me", "darwin")).toBe(true);
    expect(isSamePath("/x", "/x")).toBe(true);
  });
});
