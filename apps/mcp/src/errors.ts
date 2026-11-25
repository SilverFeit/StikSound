/** A request the tool cannot act on: a bad path, a missing input, an option that does not apply. */
export class ToolInputError extends Error {
  public readonly code = "invalid-input";

  constructor(message: string) {
    super(message);
    this.name = "ToolInputError";
  }
}
