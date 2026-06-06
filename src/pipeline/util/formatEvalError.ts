import { OpenAiApiError } from "../openai/chatCompletionsApi";

/** One-line error summary for logs and `processing_jobs.error`. */
export function formatEvalError(e: unknown): string {
  if (e instanceof Error) {
    const name = e.name && e.name !== "Error" ? `${e.name}: ` : "";
    return `${name}${e.message}`.slice(0, 4000);
  }
  return String(e).slice(0, 4000);
}

const MEMORY_LIMIT_RE = /exceeded\s+memory|exceeded\s+resource|error\s*1102|worker exceeded resource limits/i;

export function isLikelyWorkerMemoryLimitError(e: unknown): boolean {
  if (!(e instanceof Error)) return MEMORY_LIMIT_RE.test(String(e));
  return MEMORY_LIMIT_RE.test(e.message) || MEMORY_LIMIT_RE.test(e.name);
}

export function evalErrorFields(e: unknown): {
  message: string;
  name: string;
  stack?: string;
  openai_body?: string;
  likely_memory_limit?: boolean;
} {
  if (e instanceof Error) {
    const fields: {
      name: string;
      message: string;
      stack?: string;
      openai_body?: string;
      likely_memory_limit?: boolean;
    } = {
      name: e.name,
      message: e.message,
      stack: e.stack,
    };
    if (isLikelyWorkerMemoryLimitError(e)) {
      fields.likely_memory_limit = true;
    }
    if (e instanceof OpenAiApiError && e.bodySnippet.trim()) {
      fields.openai_body = e.bodySnippet.slice(0, 800);
    }
    return fields;
  }
  return { name: "Unknown", message: String(e) };
}
