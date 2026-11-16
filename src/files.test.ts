import { posix, win32 } from "node:path";
import { describe, expect, it } from "vitest";
import { PathUtils } from "./files";

describe("PathUtils.toPosix", () => {
  it("converts a path with Windows separators to / on any host", () => {
    expect(PathUtils.toPosix("AppData\\Roaming\\Code\\User\\settings.json", win32.sep)).toBe(
      "AppData/Roaming/Code/User/settings.json"
    );
    expect(PathUtils.toPosix(win32.join(".config", "nvim", "init.lua"), win32.sep)).toBe(
      ".config/nvim/init.lua"
    );
    expect(
      PathUtils.toPosix(win32.relative("C:\\Users\\me", "C:\\Users\\me\\a\\b"), win32.sep)
    ).toBe("a/b");
  });
});

describe("PathUtils.normalizeSlashes", () => {
  it("turns every backslash into a slash and leaves everything else", () => {
    expect(PathUtils.normalizeSlashes(".config\\app\\tmp\\")).toBe(".config/app/tmp/");
    expect(PathUtils.normalizeSlashes("mixed/style\\path")).toBe("mixed/style/path");
    expect(PathUtils.normalizeSlashes("already/posix")).toBe("already/posix");
    expect(PathUtils.normalizeSlashes("spaces dir\\ünï cödé.txt")).toBe("spaces dir/ünï cödé.txt");
  });
});

describe("PathUtils.archiveEntryName", () => {
  it("roots the entry at the collection name with / separators, even from a win32 path", () => {
    const name = "dotfiles-20260902-110342";
    expect(
      PathUtils.archiveEntryName(name, "AppData\\Roaming\\Code\\User\\settings.json", win32.sep)
    ).toBe(`${name}/AppData/Roaming/Code/User/settings.json`);
    expect(PathUtils.archiveEntryName(name, ".zshrc", win32.sep)).toBe(`${name}/.zshrc`);
    expect(PathUtils.archiveEntryName(name, ".config/nvim/init.lua", posix.sep)).toBe(
      `${name}/.config/nvim/init.lua`
    );
  });

  it("never produces a backslash or an absolute name, which yazl and tar readers reject", () => {
    const names = [
      PathUtils.archiveEntryName("c", win32.join("a", "b", "c.txt"), win32.sep),
      PathUtils.archiveEntryName("c", posix.join("a", "b", "c.txt"), posix.sep),
    ];
    for (const entry of names) {
      expect(entry).toBe("c/a/b/c.txt");
      expect(entry).not.toContain("\\");
      expect(entry.startsWith("/")).toBe(false);
    }
  });
});

describe("PathUtils.isSamePath", () => {
  it("compares case-insensitively on win32 and exactly elsewhere", () => {
    expect(PathUtils.isSamePath("C:\\Users\\Me", "c:\\users\\me", "win32")).toBe(true);
    expect(PathUtils.isSamePath("C:\\Users\\Me", "C:\\Users\\You", "win32")).toBe(false);
    expect(PathUtils.isSamePath("/home/Me", "/home/me", "linux")).toBe(false);
    expect(PathUtils.isSamePath("/home/me", "/home/me", "darwin")).toBe(true);
    expect(PathUtils.isSamePath("/x", "/x")).toBe(true);
  });
});

describe("PathUtils.trimTrailingSlashes", () => {
  it("drops trailing slashes down to the minimum length", () => {
    expect(PathUtils.trimTrailingSlashes("a/b//")).toBe("a/b");
    expect(PathUtils.trimTrailingSlashes("///")).toBe("");
    expect(PathUtils.trimTrailingSlashes("/", 1)).toBe("/");
    expect(PathUtils.trimTrailingSlashes("a/", 1)).toBe("a");
  });

  it("stays linear on many slashes that are not at the end", () => {
    const input = `${"/".repeat(100_000)}x`;
    const started = performance.now();
    expect(PathUtils.trimTrailingSlashes(input)).toBe(input);
    expect(performance.now() - started).toBeLessThan(100);
  });
});
