import { OpenAiApiError } from "../openai/responsesApi";

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
  openai_body?: string;
} {
  if (e instanceof Error) {
    const fields: {
      name: string;
      message: string;
      stack?: string;
      openai_body?: string;
    } = {
      name: e.name,
      message: e.message,
      stack: e.stack,
    };
    if (e instanceof OpenAiApiError && e.bodySnippet.trim()) {
      fields.openai_body = e.bodySnippet.slice(0, 800);
    }
    return fields;
  }
  return { name: "Unknown", message: String(e) };
}
