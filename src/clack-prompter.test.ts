import * as clack from "@clack/prompts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClackPrompter } from "./clack-prompter";
import { CANCEL } from "./interactive";

const CLACK_CANCEL = Symbol("clack-cancel");

vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  cancel: vi.fn(),
  note: vi.fn(),
  confirm: vi.fn(),
  multiselect: vi.fn(),
  spinner: vi.fn(),
  isCancel: (value: unknown) => typeof value === "symbol",
}));

const mocked = vi.mocked(clack);

describe("createClackPrompter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards intro, outro, cancel and note", () => {
    const prompter = createClackPrompter();

    prompter.intro("title");
    prompter.outro("bye");
    prompter.cancel("Cancelled.");
    prompter.note("body", "heading");

    expect(mocked.intro).toHaveBeenCalledWith("title");
    expect(mocked.outro).toHaveBeenCalledWith("bye");
    expect(mocked.cancel).toHaveBeenCalledWith("Cancelled.");
    expect(mocked.note).toHaveBeenCalledWith("body", "heading");
  });

  it("returns confirm answers and maps clack's cancel symbol to CANCEL", async () => {
    mocked.confirm
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(CLACK_CANCEL);
    const prompter = createClackPrompter();
    const prompt = { message: "Proceed?", initialValue: true };

    await expect(prompter.confirm(prompt)).resolves.toBe(true);
    await expect(prompter.confirm(prompt)).resolves.toBe(false);
    await expect(prompter.confirm(prompt)).resolves.toBe(CANCEL);
    expect(mocked.confirm).toHaveBeenCalledWith(prompt);
  });

  it("returns multiselect answers and maps clack's cancel symbol to CANCEL", async () => {
    mocked.multiselect.mockResolvedValueOnce(["zip", "tar"]).mockResolvedValueOnce(CLACK_CANCEL);
    const prompter = createClackPrompter();
    const prompt = {
      message: "Output formats",
      options: [{ value: "zip", label: "zip" }],
      initialValues: ["zip"],
      required: true,
    };

    await expect(prompter.multiselect(prompt)).resolves.toEqual(["zip", "tar"]);
    await expect(prompter.multiselect(prompt)).resolves.toBe(CANCEL);
    expect(mocked.multiselect).toHaveBeenCalledWith(prompt);
  });

  it("drives a clack spinner", () => {
    const spin = { start: vi.fn(), message: vi.fn(), stop: vi.fn() };
    mocked.spinner.mockReturnValue(spin as unknown as ReturnType<typeof clack.spinner>);
    const prompter = createClackPrompter();

    const handle = prompter.spinner();
    handle.start("Scanning");
    handle.message("Copying 1/2");
    handle.stop("Done");

    expect(mocked.spinner).toHaveBeenCalledTimes(1);
    expect(spin.start).toHaveBeenCalledWith("Scanning");
    expect(spin.message).toHaveBeenCalledWith("Copying 1/2");
    expect(spin.stop).toHaveBeenCalledWith("Done");
  });
});
