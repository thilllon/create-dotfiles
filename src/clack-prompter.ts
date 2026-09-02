import * as clack from "@clack/prompts";
import { CANCEL, type MultiselectPrompt, type Prompter } from "./interactive";

/** Adapts @clack/prompts to the {@link Prompter} interface the interactive flow uses. */
export function createClackPrompter(): Prompter {
  return {
    intro: (title) => clack.intro(title),
    outro: (message) => clack.outro(message),
    cancel: (message) => clack.cancel(message),
    note: (message, title) => clack.note(message, title),

    async confirm(prompt) {
      const answer = await clack.confirm(prompt);
      return clack.isCancel(answer) ? CANCEL : answer;
    },

    async multiselect<T extends string>(prompt: MultiselectPrompt<T>) {
      // clack's Option<Value> is a conditional type that cannot be resolved against a free
      // type parameter, so the call is made with `string` and narrowed back afterwards.
      const answer = await clack.multiselect<string>(prompt);
      return clack.isCancel(answer) ? CANCEL : (answer as T[]);
    },

    spinner() {
      const spin = clack.spinner();
      return {
        start: (message) => spin.start(message),
        message: (message) => spin.message(message),
        stop: (message) => spin.stop(message),
      };
    },
  };
}
