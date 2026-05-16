/** Encode bytes to base64 without per-byte string growth (Workers 128 MB isolate limit). */
export function bytesToBase64(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  const chunk = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunk) {
    const slice = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode.apply(null, slice as unknown as number[]);
  }
  return btoa(binary);
}
