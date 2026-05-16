/** True when eval consumer runs under local `wrangler dev` (`CWW_ENV=local`). */
export function isLocalEvalEnv(env: { CWW_ENV?: string }): boolean {
  return String(env.CWW_ENV ?? "").trim().toLowerCase() === "local";
}
