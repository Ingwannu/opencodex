import { OAuthConfig } from "./oauth.js";
import { mergeTokenIntoAccount, refreshAccessToken } from "./oauth.js";
import { normalizeProvider, rememberError } from "./quota.js";
import type { Account } from "./types.js";

const DEFAULT_XAI_OAUTH_CLIENT_ID = "b1a00492-073a-47ea-816f-4c329264a828";
const DEFAULT_XAI_OAUTH_TOKEN_URL = "https://auth.x.ai/oauth2/token";

function isXaiOAuthAccount(account: Account): boolean {
  return (
    String(account.providerId ?? account.provider ?? "").toLowerCase() === "xai" &&
    account.providerAuthType === "oauth"
  );
}

async function refreshXaiAccessToken(refreshToken: string) {
  const res = await fetch(process.env.XAI_OAUTH_TOKEN_URL ?? DEFAULT_XAI_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: process.env.XAI_OAUTH_CLIENT_ID ?? DEFAULT_XAI_OAUTH_CLIENT_ID,
      refresh_token: refreshToken,
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`xAI token endpoint failed ${res.status}: ${text.slice(0, 400)}`);
  }
  return JSON.parse(text) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
}

async function ensureValidXaiToken(account: Account): Promise<Account> {
  if (!account.refreshToken) return account;
  if (account.expiresAt && Date.now() < account.expiresAt - 2 * 60_000) {
    return account;
  }

  try {
    const refreshed = await refreshXaiAccessToken(account.refreshToken);
    const expiresAt = refreshed.expires_in
      ? Date.now() + refreshed.expires_in * 1000
      : account.expiresAt;
    return {
      ...account,
      accessToken: refreshed.access_token,
      refreshToken: refreshed.refresh_token ?? account.refreshToken,
      expiresAt,
      state: {
        ...account.state,
        needsTokenRefresh: false,
      },
    };
  } catch (err: any) {
    rememberError(
      account,
      `xAI refresh token failed: ${err?.message ?? String(err)}`,
    );
    account.state = {
      ...account.state,
      needsTokenRefresh: true,
    };
    return account;
  }
}

export async function ensureValidToken(
  account: Account,
  oauthConfig: OAuthConfig,
): Promise<Account> {
  if (isXaiOAuthAccount(account)) return ensureValidXaiToken(account);
  if (normalizeProvider(account) !== "openai") return account;
  if (!account.expiresAt || Date.now() < account.expiresAt - 5 * 60_000)
    return account;
  if (!account.refreshToken) return account;

  try {
    const refreshed = await refreshAccessToken(
      oauthConfig,
      account.refreshToken,
    );
    const merged = mergeTokenIntoAccount(account, refreshed);
    merged.state = {
      ...merged.state,
      needsTokenRefresh: false,
    };
    return merged;
  } catch (err: any) {
    rememberError(
      account,
      `refresh token failed: ${err?.message ?? String(err)}`,
    );
    account.state = {
      ...account.state,
      needsTokenRefresh: true,
    };
    return account;
  }
}
