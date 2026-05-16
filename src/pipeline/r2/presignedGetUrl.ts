import { AwsClient } from "aws4fetch";

export const R2_VISION_BUCKET_DEFAULT = "cubewizard-deck-images";
export const R2_PRESIGN_EXPIRES_SECONDS_DEFAULT = 3600;

export interface R2PresignEnv {
  CLOUDFLARE_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  /** Override bucket name (default cubewizard-deck-images). */
  CW_EVAL_VISION_R2_BUCKET?: string;
}

export type VisionUrlMode = "public" | "presigned";

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

function r2ObjectUrl(accountId: string, bucket: string, objectKey: string): URL {
  const key = objectKey.replace(/^\/+/, "");
  return new URL(`https://${accountId}.r2.cloudflarestorage.com/${bucket}/${key}`);
}

/**
 * Short-lived HTTPS GET URL for a private R2 object (OpenAI vision fetches this).
 */
export async function createR2PresignedGetUrl(
  env: R2PresignEnv,
  objectKey: string,
  expiresInSeconds: number = R2_PRESIGN_EXPIRES_SECONDS_DEFAULT
): Promise<string> {
  const accountId = parseCloudflareAccountId(env.CLOUDFLARE_ACCOUNT_ID);
  const accessKeyId = String(env.R2_ACCESS_KEY_ID ?? "").trim();
  const secretAccessKey = String(env.R2_SECRET_ACCESS_KEY ?? "").trim();
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error("r2_presign_credentials_missing");
  }

  const bucket = String(env.CW_EVAL_VISION_R2_BUCKET ?? R2_VISION_BUCKET_DEFAULT).trim();
  const url = r2ObjectUrl(accountId, bucket, objectKey);
  const client = new AwsClient({
    accessKeyId,
    secretAccessKey,
    service: "s3",
    region: "auto",
  });

  const signed = await client.sign(
    new Request(url.toString(), { method: "GET" }),
    {
      aws: { signQuery: true, allHeaders: true },
      expiresIn: Math.max(60, Math.min(604800, expiresInSeconds)),
    }
  );
  return signed.url;
}

export function publicUrlForR2Key(publicBase: string, objectKey: string): string {
  const base = publicBase.replace(/\/+$/, "");
  const key = objectKey.replace(/^\/+/, "");
  const segments = key.split("/").map((s) => encodeURIComponent(s));
  return `${base}/${segments.join("/")}`;
}
