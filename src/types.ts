export type RouteProviderId =
  | "openai"
  | "openai-compatible"
  | "mistral"
  | "zai"
  | "anthropic"
  | "google"
  | "cohere"
  | "amazon-bedrock"
  | "vertex";
export type ProviderAdapter =
  | RouteProviderId
  | "azure"
  | "unsupported";
export type ProviderId = string;
export type UpstreamMode = "responses" | "chat/completions";
export type CompatibilityMode =
  | "auto"
  | "responses"
  | "chat-completions-bridge";
export type OpenAiPathPrefix = "v1" | "none";

export type UsageWindow = {
  usedPercent?: number;
  resetAt?: number; // epoch ms
};

export type UsageSnapshot = {
  primary?: UsageWindow; // ~5h window
  secondary?: UsageWindow; // weekly window
  fetchedAt: number;
};

export type AccountError = {
  at: number;
  message: string;
};

export type AccountState = {
  modelBlocks?: Record<string, { until: number; reason: string }>;
  lastError?: string;
  lastSelectedAt?: number;
  recentErrors?: AccountError[];
  recentEmptyResponses?: AccountError[];
  needsTokenRefresh?: boolean;
  lastUsageRefreshAt?: number;
};

export type Account = {
  id: string;
  provider?: ProviderId;
  providerId?: string;
  providerAdapter?: ProviderAdapter;
  providerLabel?: string;
  providerNpm?: string;
  providerSource?: "builtin" | "models.dev" | "opencode" | "manual";
  providerDoc?: string;
  providerAuthEnv?: string[];
  providerModels?: Record<string, unknown>;
  upstreamMode?: UpstreamMode;
  compatibilityMode?: CompatibilityMode;
  openAiPathPrefix?: OpenAiPathPrefix;
  email?: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  chatgptAccountId?: string;
  baseUrl?: string;
  enabled: boolean;
  priority?: number;
  usage?: UsageSnapshot;
  state?: AccountState;
};

export type ModelAlias = {
  id: string;
  targets: string[];
  enabled: boolean;
  description?: string;
};

export type StoreSettings = {
  defaultPassthroughAccountId?: string;
};

export type StoreFile = {
  accounts: Account[];
  modelAliases?: ModelAlias[];
  settings?: StoreSettings;
};

export type OAuthFlowState = {
  id: string;
  email: string;
  codeVerifier: string;
  createdAt: number;
  targetAccountId?: string;
  status: "pending" | "success" | "error";
  error?: string;
  completedAt?: number;
  accountId?: string;
};

export type OAuthStateFile = {
  states: OAuthFlowState[];
};
