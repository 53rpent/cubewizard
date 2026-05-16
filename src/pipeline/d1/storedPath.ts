/**
 * Normalizes a stored image path relative to the output prefix.
 */
export function normalizeStoredImagePathRelativeToOutput(storedImagePath: string): string {
  let s = (storedImagePath || "").trim().replace(/\\/g, "/").replace(/^\/+/, "");
  while (s.toLowerCase().startsWith("output/")) {
    s = s.slice(7);
  }
  return s;
}
