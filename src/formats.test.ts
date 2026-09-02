import { describe, expect, it } from "vitest";
import { DotfileError } from "./errors";
import { OUTPUT_FORMATS, parseFormats } from "./formats";

describe("parseFormats", () => {
  it("parses a comma-separated list in order without duplicates", () => {
    expect(parseFormats("zip,folder,zip")).toEqual(["zip", "folder"]);
  });

  it("accepts tar.gz and tgz, in any case, as spellings of tar", () => {
    expect(parseFormats("tar.gz,tgz")).toEqual(["tar"]);
    expect(parseFormats("Tar.Gz,TGZ,tar")).toEqual(["tar"]);
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

  it("reports a value that is neither text nor a list as unknown instead of crashing", () => {
    expect(() => parseFormats(0 as never)).toThrow(DotfileError);
    expect(() => parseFormats(0 as never)).toThrow('Unknown output format "0"');
  });

  it("rejects an empty selection", () => {
    expect(() => parseFormats("")).toThrow(DotfileError);
    expect(() => parseFormats([" , "])).toThrow(/At least one output format/);
  });
});
