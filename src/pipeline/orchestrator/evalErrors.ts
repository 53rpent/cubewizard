export class PermanentEvalError extends Error {
  readonly permanent = true as const;
  constructor(message: string) {
    super(message);
    this.name = "PermanentEvalError";
  }
}
