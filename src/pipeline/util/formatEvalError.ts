/** One-line error summary for logs and `processing_jobs.error`. */
export function formatEvalError(e: unknown): string {
  if (e instanceof Error) {
    const name = e.name && e.name !== "Error" ? `${e.name}: ` : "";
    return `${name}${e.message}`.slice(0, 4000);
  }
  return String(e).slice(0, 4000);
}

export function evalErrorFields(e: unknown): {
  message: string;
  name: string;
  stack?: string;
} {
  if (e instanceof Error) {
    return {
      name: e.name,
      message: e.message,
      stack: e.stack,
    };
  }
  return { name: "Unknown", message: String(e) };
}
