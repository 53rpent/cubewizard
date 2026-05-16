/** Stable `processing_jobs.id` / legacy Firestore doc id: `u_` + url-safe base64 of `upload_id`. */
export function processingJobDocIdFromUploadId(uploadId: string): string {
  const s = String(uploadId || "");
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) {
    bin += String.fromCharCode(bytes[i]!);
  }
  const b64 = btoa(bin);
  return "u_" + b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
