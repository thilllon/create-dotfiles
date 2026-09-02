/**
 * An expected, user-facing failure (bad config, bad flag value, missing collection folder).
 * The CLI prints the message and exits 1 instead of showing a stack trace.
 */
export class DotfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DotfileError";
  }
}
