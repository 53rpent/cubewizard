export class GoldenEvalCliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoldenEvalCliError";
  }
}
