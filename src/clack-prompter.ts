import * as clack from "@clack/prompts";
import { CANCEL } from "./constants";
import type {
  Cancelled,
  ConfirmPrompt,
  MultiselectPrompt,
  PasswordPrompt,
  Prompter,
  SpinnerHandle,
} from "./interactive";

/** Adapts @clack/prompts to the {@link Prompter} interface the interactive flow uses. */
export class ClackPrompter implements Required<Prompter> {
  intro(title: string): void {
    clack.intro(title);
  }

  outro(message: string): void {
    clack.outro(message);
  }

  cancel(message: string): void {
    clack.cancel(message);
  }

  note(message: string, title: string): void {
    clack.note(message, title);
  }

  async confirm(prompt: ConfirmPrompt): Promise<boolean | Cancelled> {
    const answer = await clack.confirm(prompt);
    return clack.isCancel(answer) ? CANCEL : answer;
  }

  async multiselect<T extends string>(prompt: MultiselectPrompt<T>): Promise<T[] | Cancelled> {
    // clack's Option<Value> is a conditional type that cannot be resolved against a free type
    // parameter, so the call is made with `string` and narrowed back afterwards.
    const answer = await clack.multiselect<string>(prompt);
    return clack.isCancel(answer) ? CANCEL : (answer as T[]);
  }

  async password(prompt: PasswordPrompt): Promise<string | Cancelled> {
    const { validate } = prompt;
    const answer = await clack.password({
      message: prompt.message,
      // clack hands an empty entry to the validator as undefined.
      validate: validate === undefined ? undefined : (value) => validate(value ?? ""),
    });
    return clack.isCancel(answer) ? CANCEL : (answer ?? "");
  }

  spinner(): SpinnerHandle {
    const spin = clack.spinner();
    return {
      start: (message) => spin.start(message),
      message: (message) => spin.message(message),
      stop: (message) => spin.stop(message),
    };
  }
}
