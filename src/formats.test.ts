import { describe, expect, it } from "vitest";
import { DotfileError } from "./errors";
import { OUTPUT_FORMATS, parseFormats } from "./formats";

describe("parseFormats", () => {
  it("parses a comma-separated list in order without duplicates", () => {
    expect(parseFormats("zip,folder,zip")).toEqual(["zip", "folder"]);
  });

  it("accepts tar.gz and tgz as spellings of tar", () => {
    expect(parseFormats("tar.gz,tgz")).toEqual(["tar"]);
  });

  it("accepts an already split list, trimming and ignoring case", () => {
    expect(parseFormats([" folder ", "TAR", "zip,"])).toEqual(["folder", "tar", "zip"]);
  });

  it("accepts every supported format", () => {
    expect(parseFormats(OUTPUT_FORMATS)).toEqual(["folder", "zip", "tar"]);
  });

  it("rejects an unknown format with a DotfileError naming the value", () => {
    expect(() => parseFormats("folder,rar")).toThrow(DotfileError);
    expect(() => parseFormats("folder,rar")).toThrow(/"rar"/);
  });

  it("rejects an empty selection", () => {
    expect(() => parseFormats("")).toThrow(DotfileError);
    expect(() => parseFormats([" , "])).toThrow(/At least one output format/);
  });
});
