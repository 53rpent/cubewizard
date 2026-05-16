import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export const R2_VISION_BUCKET_DEFAULT = "cubewizard-deck-images";
export const R2_PRESIGN_EXPIRES_SECONDS_DEFAULT = 3600;

export interface R2PresignEnv {
  CLOUDFLARE_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  /** Override bucket name (default cubewizard-deck-images). */
  CW_EVAL_VISION_R2_BUCKET?: string;
}

export function parseCloudflareAccountId(raw: string | undefined): string | null {
  const id = String(raw ?? "").trim();
  return id.length >= 10 ? id : null;
}

export function hasR2PresignCredentials(env: R2PresignEnv): boolean {
  return Boolean(
    parseCloudflareAccountId(env.CLOUDFLARE_ACCOUNT_ID) &&
      String(env.R2_ACCESS_KEY_ID ?? "").trim() &&
      String(env.R2_SECRET_ACCESS_KEY ?? "").trim()
  );
}

/** Avoid checksum query params on presigned GETs (breaks some third-party fetchers). */
function createR2S3Client(env: R2PresignEnv): S3Client {
  const accountId = parseCloudflareAccountId(env.CLOUDFLARE_ACCOUNT_ID)!;
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: String(env.R2_ACCESS_KEY_ID ?? "").trim(),
      secretAccessKey: String(env.R2_SECRET_ACCESS_KEY ?? "").trim(),
    },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}

/**
 * GET the presigned URL from the Worker before OpenAI does (catches secret mismatch early).
 */
export async function verifyR2PresignedGetUrl(
  url: string,
  fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)
): Promise<void> {
  const res = await fetchImpl(url, {
    method: "GET",
    headers: { Range: "bytes=0-1023" },
  });
  if (res.ok || res.status === 206) return;

  const body = await res.text();
  if (res.status === 403 && /SignatureDoesNotMatch/i.test(body)) {
    const cred = new URL(url).searchParams.get("X-Amz-Credential") ?? "";
    const accessKeyPrefix = cred.split("/")[0]?.slice(0, 8) ?? "unknown";
    throw new Error(
      "r2_presign_signature_mismatch: R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY must be " +
        `from the same R2 API token (credential starts with ${accessKeyPrefix}…). ` +
        "Re-create the token and run both wrangler secret put commands on the eval consumer."
    );
  }
  throw new Error(`r2_presign_verify_failed: HTTP ${res.status} ${body.slice(0, 200)}`);
}

/**
 * Short-lived HTTPS GET URL for a private R2 object (OpenAI vision fetches this).
 * Virtual-hosted R2 URL via @aws-sdk/s3-request-presigner (Cloudflare-documented).
 */
export async function createR2PresignedGetUrl(
  env: R2PresignEnv,
  objectKey: string,
  expiresInSeconds: number = R2_PRESIGN_EXPIRES_SECONDS_DEFAULT,
  fetchImpl?: typeof fetch
): Promise<string> {
  const accountId = parseCloudflareAccountId(env.CLOUDFLARE_ACCOUNT_ID);
  const accessKeyId = String(env.R2_ACCESS_KEY_ID ?? "").trim();
  const secretAccessKey = String(env.R2_SECRET_ACCESS_KEY ?? "").trim();
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error("r2_presign_credentials_missing");
  }

  const bucket = String(env.CW_EVAL_VISION_R2_BUCKET ?? R2_VISION_BUCKET_DEFAULT).trim();
  const key = objectKey.replace(/^\/+/, "");
  const expiresIn = Math.max(60, Math.min(604800, expiresInSeconds));
  const client = createR2S3Client(env);

  const url = await getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn }
  );

  await verifyR2PresignedGetUrl(url, fetchImpl);
  return url;
}
