/** A user/tool request that cannot be executed (bad flag, bad path, conflicting options). */
export class CliInputError extends Error {
  public readonly code = "invalid-input";

  constructor(message: string) {
    super(message);
    this.name = "CliInputError";
  }
}
