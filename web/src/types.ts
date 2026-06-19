export type Account = {
  id: string;
  provider?: string;
  providerId?: string;
  providerAdapter?: string;
  providerLabel?: string;
  providerNpm?: string;
  providerSource?: "builtin" | "models.dev" | "opencode" | "manual";
  providerDoc?: string;
  providerAuthEnv?: string[];
  providerAuthType?: "oauth" | "api-key" | "none";
  providerOptions?: Record<string, unknown>;
  upstreamMode?: "responses" | "chat/completions";
  compatibilityMode?: "auto" | "responses" | "chat-completions-bridge";
  email?: string;
  enabled: boolean;
  accessToken?: string;
  refreshToken?: string;
  chatgptAccountId?: string;
  baseUrl?: string;
  priority?: number;
  usage?: any;
  state?: {
    modelBlocks?: Record<string, { until: number; reason: string }>;
    lastError?: string;
    lastSelectedAt?: number;
    recentErrors?: Array<{ at: number; message: string }>;
    recentEmptyResponses?: Array<{ at: number; message: string }>;
    needsTokenRefresh?: boolean;
    lastUsageRefreshAt?: number;
  };
};

export type Trace = {
  id: string;
  at: number;
  route: string;
  accountId?: string;
  accountEmail?: string;
  model?: string;
  requestedModel?: string;
  resolvedModel?: string;
  status: number;
  isError: boolean;
  stream: boolean;
  latencyMs: number;
  tokensInput?: number;
  tokensOutput?: number;
  tokensTotal?: number;
  costUsd?: number;
  usage?: any;
  error?: string;
  requestBody?: any;
  hasRequestBody?: boolean;
};

export type TraceStats = {
  totals: {
    requests: number;
    errors: number;
    errorRate: number;
    tokensInput: number;
    tokensOutput: number;
    tokensTotal: number;
    costUsd: number;
    latencyAvgMs: number;
  };
  models: Array<{
    model: string;
    count: number;
    okCount: number;
    tokensInput: number;
    tokensOutput: number;
    tokensTotal: number;
    costUsd: number;
  }>;
  timeseries: Array<{
    at: number;
    requests: number;
    errors: number;
    tokensInput: number;
    tokensOutput: number;
    tokensTotal: number;
    costUsd: number;
    latencyP50Ms: number;
    latencyP95Ms: number;
  }>;
};

export type TracePagination = {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasPrev: boolean;
  hasNext: boolean;
};

export type TraceRangePreset = "24h" | "7d" | "30d" | "all";

export type Tab =
  | "overview"
  | "accounts"
  | "aliases"
  | "tracing"
  | "playground"
  | "docs";

export type ExposedModel = {
  id: string;
  owned_by?: string;
  metadata?: {
    provider?: string;
    provider_candidates?: string[];
    is_alias?: boolean;
    alias_targets?: string[];
    upstream_model_id?: string;
  };
};

export type ProviderRegistryEntry = {
  id: string;
  providerId: string;
  label: string;
  provider: string;
  providerAdapter: string;
  providerNpm?: string;
  providerSource: "builtin" | "models.dev" | "manual";
  providerDoc?: string;
  baseUrl?: string;
  providerOptions?: Record<string, unknown>;
  upstreamMode?: "responses" | "chat/completions";
  compatibilityMode?: "auto" | "responses" | "chat-completions-bridge";
  tokenEnv: string[];
  authType: "oauth" | "api-key" | "none";
  runtimeSupported: boolean;
  modelsCount?: number;
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

export type OpenCodeImportOptions = {
  path?: string;
  configPath?: string;
  authContent?: string;
  configContent?: string;
};
