import type {
  CompatibilityMode,
  OpenAiPathPrefix,
  ProviderAdapter,
  ProviderAuthType,
  RouteProviderId,
  UpstreamMode,
} from "./types.js";

const MODELS_DEV_API_URL =
  process.env.MODELS_DEV_API_URL ?? "https://models.dev/api.json";
const MODELS_DEV_TIMEOUT_MS = Number(
  process.env.MODELS_DEV_TIMEOUT_MS ?? 2500,
);
const DEFAULT_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh/v3/ai";

export type ProviderRegistryEntry = {
  id: string;
  providerId: string;
  label: string;
  provider: string;
  providerAdapter: ProviderAdapter;
  providerNpm?: string;
  providerSource: "builtin" | "models.dev" | "manual";
  providerDoc?: string;
  baseUrl?: string;
  openAiPathPrefix?: OpenAiPathPrefix;
  upstreamMode?: UpstreamMode;
  compatibilityMode?: CompatibilityMode;
  providerOptions?: Record<string, unknown>;
  tokenEnv: string[];
  authType: ProviderAuthType;
  runtimeSupported: boolean;
  models?: Record<string, unknown>;
  modelsCount?: number;
};

type ModelsDevProvider = {
  id?: string;
  name?: string;
  npm?: string;
  api?: string;
  env?: string[];
  doc?: string;
  models?: Record<string, unknown>;
  options?: Record<string, unknown>;
};

const DISALLOWED_PROVIDER_OPTION_HEADERS = new Set([
  "api-key",
  "authorization",
  "connection",
  "content-length",
  "host",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "x-api-key",
]);

const BUILTIN_PROVIDERS: ProviderRegistryEntry[] = [
  {
    id: "openai-chatgpt",
    providerId: "openai-chatgpt",
    label: "OpenAI ChatGPT",
    provider: "openai",
    providerAdapter: "openai",
    providerSource: "builtin",
    tokenEnv: ["CHATGPT_ACCESS_TOKEN", "OPENAI_ACCESS_TOKEN"],
    authType: "oauth",
    runtimeSupported: true,
  },
  {
    id: "openai-api",
    providerId: "openai",
    label: "OpenAI API",
    provider: "openai-compatible",
    providerAdapter: "openai-compatible",
    providerNpm: "@ai-sdk/openai",
    providerSource: "builtin",
    providerDoc: "https://platform.openai.com/docs/models",
    baseUrl: "https://api.openai.com",
    upstreamMode: "responses",
    compatibilityMode: "responses",
    tokenEnv: ["OPENAI_API_KEY"],
    authType: "api-key",
    runtimeSupported: true,
  },
  {
    id: "openrouter",
    providerId: "openrouter",
    label: "OpenRouter",
    provider: "openai-compatible",
    providerAdapter: "openai-compatible",
    providerNpm: "@openrouter/ai-sdk-provider",
    providerSource: "builtin",
    providerDoc: "https://openrouter.ai/models",
    baseUrl: "https://openrouter.ai/api",
    upstreamMode: "chat/completions",
    compatibilityMode: "chat-completions-bridge",
    tokenEnv: ["OPENROUTER_API_KEY"],
    authType: "api-key",
    runtimeSupported: true,
  },
  {
    id: "vercel",
    providerId: "vercel",
    label: "Vercel AI Gateway",
    provider: "gateway",
    providerAdapter: "gateway",
    providerNpm: "@ai-sdk/gateway",
    providerSource: "builtin",
    providerDoc: "https://vercel.com/docs/ai-gateway",
    baseUrl: DEFAULT_GATEWAY_BASE_URL,
    tokenEnv: ["AI_GATEWAY_API_KEY"],
    authType: "api-key",
    runtimeSupported: true,
  },
  {
    id: "mistral",
    providerId: "mistral",
    label: "Mistral",
    provider: "mistral",
    providerAdapter: "mistral",
    providerNpm: "@ai-sdk/mistral",
    providerSource: "builtin",
    providerDoc: "https://docs.mistral.ai/getting-started/models/",
    tokenEnv: ["MISTRAL_API_KEY"],
    authType: "api-key",
    runtimeSupported: true,
  },
  {
    id: "zai",
    providerId: "zai",
    label: "Z.AI",
    provider: "zai",
    providerAdapter: "zai",
    providerNpm: "@ai-sdk/openai-compatible",
    providerSource: "builtin",
    providerDoc: "https://docs.z.ai/guides/overview/pricing",
    baseUrl: "https://api.z.ai",
    upstreamMode: "chat/completions",
    compatibilityMode: "chat-completions-bridge",
    tokenEnv: ["ZAI_API_KEY", "ZAI_TOKEN", "ZHIPU_API_KEY"],
    authType: "api-key",
    runtimeSupported: true,
  },
  {
    id: "neuralwatt",
    providerId: "neuralwatt",
    label: "Neuralwatt",
    provider: "openai-compatible",
    providerAdapter: "openai-compatible",
    providerNpm: "@ai-sdk/openai-compatible",
    providerSource: "builtin",
    baseUrl: "https://api.neuralwatt.com",
    upstreamMode: "chat/completions",
    compatibilityMode: "chat-completions-bridge",
    tokenEnv: ["NEURALWATT_API_KEY"],
    authType: "api-key",
    runtimeSupported: true,
  },
  {
    id: "requesty",
    providerId: "requesty",
    label: "Requesty",
    provider: "openai-compatible",
    providerAdapter: "openai-compatible",
    providerNpm: "@ai-sdk/openai-compatible",
    providerSource: "builtin",
    providerDoc: "https://requesty.ai/solution/llm-routing/models",
    baseUrl: "https://router.requesty.ai",
    upstreamMode: "chat/completions",
    compatibilityMode: "chat-completions-bridge",
    tokenEnv: ["REQUESTY_API_KEY"],
    authType: "api-key",
    runtimeSupported: true,
  },
  {
    id: "anthropic",
    providerId: "anthropic",
    label: "Anthropic",
    provider: "anthropic",
    providerAdapter: "anthropic",
    providerNpm: "@ai-sdk/anthropic",
    providerSource: "builtin",
    providerDoc: "https://docs.anthropic.com/en/docs/about-claude/models",
    baseUrl: "https://api.anthropic.com",
    tokenEnv: ["ANTHROPIC_API_KEY"],
    authType: "api-key",
    runtimeSupported: true,
  },
  {
    id: "google",
    providerId: "google",
    label: "Google",
    provider: "google",
    providerAdapter: "google",
    providerNpm: "@ai-sdk/google",
    providerSource: "builtin",
    providerDoc: "https://ai.google.dev/gemini-api/docs/models",
    baseUrl: "https://generativelanguage.googleapis.com",
    tokenEnv: ["GOOGLE_API_KEY", "GOOGLE_GENERATIVE_AI_API_KEY", "GEMINI_API_KEY"],
    authType: "api-key",
    runtimeSupported: true,
  },
  {
    id: "google-vertex",
    providerId: "google-vertex",
    label: "Google Vertex AI",
    provider: "vertex",
    providerAdapter: "vertex",
    providerNpm: "@ai-sdk/google-vertex",
    providerSource: "builtin",
    providerDoc: "https://opencode.ai/docs/providers/",
    baseUrl: vertexBaseUrlFromOptions(),
    providerOptions: googleVertexProviderOptionsFromSource({
      options: {
        project: process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GOOGLE_VERTEX_PROJECT,
        location: process.env.VERTEX_LOCATION ?? process.env.GOOGLE_VERTEX_LOCATION,
        credentialsFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      },
    }),
    tokenEnv: [
      "GOOGLE_VERTEX_ACCESS_TOKEN",
      "GOOGLE_ACCESS_TOKEN",
      "GOOGLE_APPLICATION_CREDENTIALS",
      "GOOGLE_CLOUD_PROJECT",
      "GOOGLE_VERTEX_PROJECT",
      "VERTEX_LOCATION",
      "GOOGLE_VERTEX_LOCATION",
    ],
    authType: "api-key",
    runtimeSupported: Boolean(vertexBaseUrlFromOptions()),
  },
  {
    id: "google-vertex-anthropic",
    providerId: "google-vertex-anthropic",
    label: "Google Vertex AI Anthropic",
    provider: "vertex-anthropic",
    providerAdapter: "vertex-anthropic",
    providerNpm: "@ai-sdk/google-vertex/anthropic",
    providerSource: "builtin",
    providerDoc: "https://opencode.ai/docs/providers/",
    baseUrl: vertexBaseUrlFromOptions(),
    providerOptions: googleVertexProviderOptionsFromSource({
      options: {
        project: process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GOOGLE_VERTEX_PROJECT,
        location: process.env.VERTEX_LOCATION ?? process.env.GOOGLE_VERTEX_LOCATION,
        credentialsFile: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      },
    }),
    tokenEnv: [
      "GOOGLE_VERTEX_ACCESS_TOKEN",
      "GOOGLE_ACCESS_TOKEN",
      "GOOGLE_APPLICATION_CREDENTIALS",
      "GOOGLE_CLOUD_PROJECT",
      "GOOGLE_VERTEX_PROJECT",
      "VERTEX_LOCATION",
      "GOOGLE_VERTEX_LOCATION",
    ],
    authType: "api-key",
    runtimeSupported: Boolean(vertexBaseUrlFromOptions()),
  },
  {
    id: "cohere",
    providerId: "cohere",
    label: "Cohere",
    provider: "cohere",
    providerAdapter: "cohere",
    providerNpm: "@ai-sdk/cohere",
    providerSource: "builtin",
    providerDoc: "https://docs.cohere.com/docs/models",
    baseUrl: "https://api.cohere.com",
    tokenEnv: ["COHERE_API_KEY"],
    authType: "api-key",
    runtimeSupported: true,
  },
  {
    id: "gitlab",
    providerId: "gitlab",
    label: "GitLab Duo",
    provider: "gitlab",
    providerAdapter: "gitlab",
    providerNpm: "gitlab-ai-provider",
    providerSource: "builtin",
    providerDoc: "https://docs.gitlab.com/user/gitlab_duo/",
    baseUrl: "https://gitlab.com",
    tokenEnv: ["GITLAB_TOKEN"],
    authType: "api-key",
    runtimeSupported: true,
  },
  {
    id: "amazon-bedrock",
    providerId: "amazon-bedrock",
    label: "Amazon Bedrock",
    provider: "amazon-bedrock",
    providerAdapter: "amazon-bedrock",
    providerNpm: "@ai-sdk/amazon-bedrock",
    providerSource: "builtin",
    providerDoc: "https://docs.aws.amazon.com/bedrock/latest/userguide/",
    baseUrl: amazonBedrockBaseUrlFromOptions(),
    providerOptions: amazonBedrockProviderOptionsFromSource({
      options: {
        region: process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION,
        profile: process.env.AWS_PROFILE ?? process.env.AWS_DEFAULT_PROFILE,
      },
    }),
    tokenEnv: [
      "AWS_BEARER_TOKEN_BEDROCK",
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "AWS_SESSION_TOKEN",
      "AWS_PROFILE",
      "AWS_DEFAULT_PROFILE",
      "AWS_REGION",
      "AWS_DEFAULT_REGION",
      "AWS_SHARED_CREDENTIALS_FILE",
    ],
    authType: "api-key",
    runtimeSupported: true,
  },
  {
    id: "sap-ai-core",
    providerId: "sap-ai-core",
    label: "SAP AI Core",
    provider: "sap-ai-core",
    providerAdapter: "sap-ai-core",
    providerNpm: "@jerome-benoit/sap-ai-provider-v2",
    providerSource: "builtin",
    providerDoc: "https://help.sap.com/docs/sap-ai-core",
    tokenEnv: ["AICORE_SERVICE_KEY"],
    authType: "api-key",
    runtimeSupported: true,
  },
  {
    id: "openai-compatible",
    providerId: "openai-compatible",
    label: "Generic OpenAI-compatible",
    provider: "openai-compatible",
    providerAdapter: "openai-compatible",
    providerNpm: "@ai-sdk/openai-compatible",
    providerSource: "builtin",
    upstreamMode: "chat/completions",
    compatibilityMode: "chat-completions-bridge",
    tokenEnv: ["OPENAI_COMPATIBLE_API_KEY"],
    authType: "api-key",
    runtimeSupported: true,
  },
  {
    id: "ollama",
    providerId: "ollama",
    label: "Ollama (local)",
    provider: "openai-compatible",
    providerAdapter: "openai-compatible",
    providerNpm: "@ai-sdk/openai-compatible",
    providerSource: "builtin",
    providerDoc: "https://opencode.ai/docs/providers/",
    baseUrl: "http://127.0.0.1:11434",
    upstreamMode: "chat/completions",
    compatibilityMode: "chat-completions-bridge",
    tokenEnv: [],
    authType: "none",
    runtimeSupported: true,
  },
  {
    id: "lmstudio",
    providerId: "lmstudio",
    label: "LM Studio (local)",
    provider: "openai-compatible",
    providerAdapter: "openai-compatible",
    providerNpm: "@ai-sdk/openai-compatible",
    providerSource: "builtin",
    providerDoc: "https://opencode.ai/docs/providers/",
    baseUrl: "http://127.0.0.1:1234",
    upstreamMode: "chat/completions",
    compatibilityMode: "chat-completions-bridge",
    tokenEnv: [],
    authType: "none",
    runtimeSupported: true,
  },
  {
    id: "llama.cpp",
    providerId: "llama.cpp",
    label: "llama.cpp (local)",
    provider: "openai-compatible",
    providerAdapter: "openai-compatible",
    providerNpm: "@ai-sdk/openai-compatible",
    providerSource: "builtin",
    providerDoc: "https://opencode.ai/docs/providers/",
    baseUrl: "http://127.0.0.1:8080",
    upstreamMode: "chat/completions",
    compatibilityMode: "chat-completions-bridge",
    tokenEnv: [],
    authType: "none",
    runtimeSupported: true,
  },
];

const PROVIDER_ALIASES: Record<string, string> = {
  "302.ai": "302ai",
  "302-ai": "302ai",
  "azure-openai": "azure",
  chatgpt: "openai-chatgpt",
  "deep-infra": "deepinfra",
  "gitlab-duo": "gitlab",
  "google-vertex-ai": "google-vertex",
  "hugging-face": "huggingface",
  "io.net": "io-net",
  "lm-studio": "lmstudio",
  "llm-gateway": "llmgateway",
  "moonshot-ai": "moonshotai",
  "nebius-token-factory": "nebius",
  openai: "openai-api",
  "openai-responses": "openai-api",
  "opencode-zen": "opencode",
  "ovhcloud-ai-endpoints": "ovhcloud",
  "together-ai": "togetherai",
  "venice-ai": "venice",
  "vercel-ai-gateway": "vercel",
  "z.ai": "zai",
  zaiorg: "zai",
  zhipu: "zai",
};

type OpenAiCompatibleProviderDefault = {
  baseUrl?: string;
  label?: string;
  tokenEnv?: string[];
  providerDoc?: string;
  openAiPathPrefix?: OpenAiPathPrefix;
  upstreamMode?: UpstreamMode;
  compatibilityMode?: CompatibilityMode;
};

const OPENAI_COMPATIBLE_SDK_PROVIDER_DEFAULTS: Record<
  string,
  OpenAiCompatibleProviderDefault
> = {
  "302ai": {
    label: "302.AI",
    baseUrl: "https://api.302.ai/v1",
    tokenEnv: ["302AI_API_KEY"],
  },
  abacus: {
    label: "Abacus",
    baseUrl: "https://routellm.abacus.ai/v1",
    tokenEnv: ["ABACUS_API_KEY"],
  },
  "abliteration-ai": {
    label: "abliteration.ai",
    baseUrl: "https://api.abliteration.ai/v1",
    tokenEnv: ["ABLIT_KEY"],
  },
  alibaba: {
    label: "Alibaba",
    baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
    tokenEnv: ["DASHSCOPE_API_KEY"],
  },
  "alibaba-cn": {
    label: "Alibaba (China)",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    tokenEnv: ["DASHSCOPE_API_KEY"],
  },
  "alibaba-coding-plan": {
    label: "Alibaba Coding Plan",
    baseUrl: "https://coding-intl.dashscope.aliyuncs.com/v1",
    tokenEnv: ["ALIBABA_CODING_PLAN_API_KEY"],
  },
  "alibaba-coding-plan-cn": {
    label: "Alibaba Coding Plan (China)",
    baseUrl: "https://coding.dashscope.aliyuncs.com/v1",
    tokenEnv: ["ALIBABA_CODING_PLAN_API_KEY"],
  },
  "alibaba-token-plan": {
    label: "Alibaba Token Plan",
    baseUrl:
      "https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
    tokenEnv: ["ALIBABA_TOKEN_PLAN_API_KEY"],
  },
  "alibaba-token-plan-cn": {
    label: "Alibaba Token Plan (China)",
    baseUrl:
      "https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1",
    tokenEnv: ["ALIBABA_TOKEN_PLAN_API_KEY"],
  },
  ambient: {
    label: "Ambient",
    baseUrl: "https://api.ambient.xyz/v1",
    tokenEnv: ["AMBIENT_API_KEY"],
  },
  anyapi: {
    label: "AnyAPI",
    baseUrl: "https://api.anyapi.ai/v1",
    tokenEnv: ["ANYAPI_API_KEY"],
  },
  "atomic-chat": {
    label: "Atomic Chat",
    baseUrl: "http://127.0.0.1:1337/v1",
    tokenEnv: ["ATOMIC_CHAT_API_KEY"],
  },
  auriko: {
    label: "Auriko",
    baseUrl: "https://api.auriko.ai/v1",
    tokenEnv: ["AURIKO_API_KEY"],
  },
  bailing: {
    label: "Bailing",
    baseUrl: "https://api.tbox.cn/api/llm/v1/chat/completions",
    tokenEnv: ["BAILING_API_TOKEN"],
  },
  baseten: {
    label: "Baseten",
    baseUrl: "https://inference.baseten.co/v1",
    tokenEnv: ["BASETEN_API_KEY"],
  },
  berget: {
    label: "Berget.AI",
    baseUrl: "https://api.berget.ai/v1",
    tokenEnv: ["BERGET_API_KEY"],
  },
  chutes: {
    label: "Chutes",
    baseUrl: "https://llm.chutes.ai/v1",
    tokenEnv: ["CHUTES_API_KEY"],
  },
  claudinio: {
    label: "Claudinio",
    baseUrl: "https://api.claudin.io/v1",
    tokenEnv: ["CLAUDINIO_API_KEY"],
  },
  clarifai: {
    label: "Clarifai",
    baseUrl: "https://api.clarifai.com/v2/ext/openai/v1",
    tokenEnv: ["CLARIFAI_PAT"],
  },
  "cloudferro-sherlock": {
    label: "CloudFerro Sherlock",
    baseUrl: "https://api-sherlock.cloudferro.com/openai/v1/",
    tokenEnv: ["CLOUDFERRO_SHERLOCK_API_KEY"],
  },
  cortecs: {
    label: "Cortecs",
    baseUrl: "https://api.cortecs.ai/v1",
    tokenEnv: ["CORTECS_API_KEY"],
  },
  crof: {
    label: "CrofAI",
    baseUrl: "https://crof.ai/v1",
    tokenEnv: ["CROF_API_KEY"],
  },
  deepseek: {
    label: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    tokenEnv: ["DEEPSEEK_API_KEY"],
  },
  digitalocean: {
    label: "DigitalOcean",
    baseUrl: "https://inference.do-ai.run/v1",
    tokenEnv: ["DIGITALOCEAN_ACCESS_TOKEN"],
  },
  dinference: {
    label: "DInference",
    baseUrl: "https://api.dinference.com/v1",
    tokenEnv: ["DINFERENCE_API_KEY"],
  },
  drun: {
    label: "D.Run (China)",
    baseUrl: "https://chat.d.run/v1",
    tokenEnv: ["DRUN_API_KEY"],
  },
  evroc: {
    label: "evroc",
    baseUrl: "https://models.think.evroc.com/v1",
    tokenEnv: ["EVROC_API_KEY"],
  },
  fastrouter: {
    label: "FastRouter",
    baseUrl: "https://go.fastrouter.ai/api/v1",
    tokenEnv: ["FASTROUTER_API_KEY"],
  },
  firepass: {
    label: "Fireworks (Firepass)",
    baseUrl: "https://api.fireworks.ai/inference/v1/",
    tokenEnv: ["FIREPASS_API_KEY"],
  },
  "fireworks-ai": {
    label: "Fireworks AI",
    baseUrl: "https://api.fireworks.ai/inference/v1/",
    tokenEnv: ["FIREWORKS_API_KEY"],
  },
  friendli: {
    label: "Friendli",
    baseUrl: "https://api.friendli.ai/serverless/v1",
    tokenEnv: ["FRIENDLI_TOKEN"],
  },
  frogbot: {
    label: "FrogBot",
    baseUrl: "https://app.frogbot.ai/api/v1",
    tokenEnv: ["FROGBOT_API_KEY"],
  },
  gmicloud: {
    label: "GMI Cloud",
    baseUrl: "https://api.gmi-serving.com/v1",
    tokenEnv: ["GMICLOUD_API_KEY"],
  },
  "github-copilot": {
    label: "GitHub Copilot",
    baseUrl: "https://api.githubcopilot.com",
    tokenEnv: ["GITHUB_TOKEN"],
  },
  "github-models": {
    label: "GitHub Models",
    baseUrl: "https://models.github.ai/inference",
    tokenEnv: ["GITHUB_TOKEN"],
  },
  huggingface: {
    label: "Hugging Face",
    baseUrl: "https://router.huggingface.co/v1",
    tokenEnv: ["HF_TOKEN"],
  },
  helicone: {
    label: "Helicone",
    baseUrl: "https://ai-gateway.helicone.ai/v1",
    tokenEnv: ["HELICONE_API_KEY"],
  },
  "io-net": {
    label: "IO.NET",
    baseUrl: "https://api.intelligence.io.solutions/api/v1",
    tokenEnv: ["IOINTELLIGENCE_API_KEY"],
  },
  "hpc-ai": {
    label: "HPC-AI",
    baseUrl: "https://api.hpc-ai.com/inference/v1",
    tokenEnv: ["HPC_AI_API_KEY"],
  },
  iflowcn: {
    label: "iFlow",
    baseUrl: "https://apis.iflow.cn/v1",
    tokenEnv: ["IFLOW_API_KEY"],
  },
  inception: {
    label: "Inception",
    baseUrl: "https://api.inceptionlabs.ai/v1/",
    tokenEnv: ["INCEPTION_API_KEY"],
  },
  inceptron: {
    label: "Inceptron",
    baseUrl: "https://api.inceptron.io/v1",
    tokenEnv: ["INCEPTRON_API_KEY"],
  },
  inference: {
    label: "Inference",
    baseUrl: "https://inference.net/v1",
    tokenEnv: ["INFERENCE_API_KEY"],
  },
  jiekou: {
    label: "Jiekou.AI",
    baseUrl: "https://api.jiekou.ai/openai",
    tokenEnv: ["JIEKOU_API_KEY"],
  },
  kilo: {
    label: "Kilo Gateway",
    baseUrl: "https://api.kilo.ai/api/gateway",
    tokenEnv: ["KILO_API_KEY"],
  },
  "kuae-cloud-coding-plan": {
    label: "KUAE Cloud Coding Plan",
    baseUrl: "https://coding-plan-endpoint.kuaecloud.net/v1",
    tokenEnv: ["KUAE_API_KEY"],
  },
  llmgateway: {
    label: "LLM Gateway",
    baseUrl: "https://api.llmgateway.io/v1",
    tokenEnv: ["LLMGATEWAY_API_KEY"],
  },
  llama: {
    label: "Llama",
    baseUrl: "https://api.llama.com/compat/v1/",
    tokenEnv: ["LLAMA_API_KEY"],
  },
  lilac: {
    label: "Lilac",
    baseUrl: "https://api.getlilac.com/v1",
    tokenEnv: ["LILAC_API_KEY"],
  },
  llmtr: {
    label: "LLMTR",
    baseUrl: "https://llmtr.com/v1",
    tokenEnv: ["LLMTR_API_KEY"],
  },
  lucidquery: {
    label: "LucidQuery",
    baseUrl: "https://api.lucidquery.com/v1",
    tokenEnv: ["LUCIDQUERY_API_KEY"],
  },
  meganova: {
    label: "Meganova",
    baseUrl: "https://api.meganova.ai/v1",
    tokenEnv: ["MEGANOVA_API_KEY"],
  },
  mixlayer: {
    label: "Mixlayer",
    baseUrl: "https://models.mixlayer.ai/v1",
    tokenEnv: ["MIXLAYER_API_KEY"],
  },
  moark: {
    label: "Moark",
    baseUrl: "https://moark.com/v1",
    tokenEnv: ["MOARK_API_KEY"],
  },
  modelscope: {
    label: "ModelScope",
    baseUrl: "https://api-inference.modelscope.cn/v1",
    tokenEnv: ["MODELSCOPE_API_KEY"],
  },
  moonshotai: {
    label: "Moonshot AI",
    baseUrl: "https://api.moonshot.ai/v1",
    tokenEnv: ["MOONSHOT_API_KEY"],
  },
  "moonshotai-cn": {
    label: "Moonshot AI (China)",
    baseUrl: "https://api.moonshot.cn/v1",
    tokenEnv: ["MOONSHOT_API_KEY"],
  },
  morph: {
    label: "Morph",
    baseUrl: "https://api.morphllm.com/v1",
    tokenEnv: ["MORPH_API_KEY"],
  },
  "nano-gpt": {
    label: "NanoGPT",
    baseUrl: "https://nano-gpt.com/api/v1",
    tokenEnv: ["NANO_GPT_API_KEY"],
  },
  nearai: {
    label: "NEAR AI Cloud",
    baseUrl: "https://cloud-api.near.ai/v1",
    tokenEnv: ["NEARAI_API_KEY"],
  },
  nvidia: {
    label: "NVIDIA",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    tokenEnv: ["NVIDIA_API_KEY"],
  },
  nebius: {
    label: "Nebius Token Factory",
    baseUrl: "https://api.tokenfactory.nebius.com/v1",
    tokenEnv: ["NEBIUS_API_KEY"],
  },
  nova: {
    label: "Nova",
    baseUrl: "https://api.nova.amazon.com/v1",
    tokenEnv: ["NOVA_API_KEY"],
  },
  neuralwatt: {
    label: "Neuralwatt",
    baseUrl: "https://api.neuralwatt.com/v1",
    tokenEnv: ["NEURALWATT_API_KEY"],
  },
  "ollama-cloud": {
    label: "Ollama Cloud",
    baseUrl: "https://ollama.com/v1",
    tokenEnv: ["OLLAMA_API_KEY"],
  },
  opencode: {
    label: "OpenCode Zen",
    baseUrl: "https://opencode.ai/zen/v1",
    tokenEnv: ["OPENCODE_API_KEY"],
  },
  "opencode-go": {
    label: "OpenCode Go",
    baseUrl: "https://opencode.ai/zen/go/v1",
    tokenEnv: ["OPENCODE_API_KEY"],
  },
  openrouter: {
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    tokenEnv: ["OPENROUTER_API_KEY"],
  },
  "novita-ai": {
    label: "NovitaAI",
    baseUrl: "https://api.novita.ai/openai",
    tokenEnv: ["NOVITA_API_KEY"],
  },
  orcarouter: {
    label: "OrcaRouter",
    baseUrl: "https://api.orcarouter.ai/v1",
    tokenEnv: ["ORCAROUTER_API_KEY"],
  },
  ovhcloud: {
    label: "OVHcloud AI Endpoints",
    baseUrl: "https://oai.endpoints.kepler.ai.cloud.ovh.net/v1",
    tokenEnv: ["OVHCLOUD_API_KEY"],
  },
  poe: {
    label: "Poe",
    baseUrl: "https://api.poe.com/v1",
    tokenEnv: ["POE_API_KEY"],
  },
  poolside: {
    label: "Poolside",
    baseUrl: "https://inference.poolside.ai/v1",
    tokenEnv: ["POOLSIDE_API_KEY"],
  },
  "privatemode-ai": {
    label: "Privatemode AI",
    baseUrl: "http://localhost:8080/v1",
    tokenEnv: ["PRIVATEMODE_API_KEY", "PRIVATEMODE_ENDPOINT"],
  },
  "qihang-ai": {
    label: "QiHang",
    baseUrl: "https://api.qhaigc.net/v1",
    tokenEnv: ["QIHANG_API_KEY"],
  },
  "qiniu-ai": {
    label: "Qiniu",
    baseUrl: "https://api.qnaigc.com/v1",
    tokenEnv: ["QINIU_API_KEY"],
  },
  "regolo-ai": {
    label: "Regolo AI",
    baseUrl: "https://api.regolo.ai/v1",
    tokenEnv: ["REGOLO_API_KEY"],
  },
  requesty: {
    label: "Requesty",
    baseUrl: "https://router.requesty.ai/v1",
    tokenEnv: ["REQUESTY_API_KEY"],
  },
  "routing-run": {
    label: "routing.run",
    baseUrl: "https://ai.routing.sh/v1",
    tokenEnv: ["ROUTING_RUN_API_KEY"],
  },
  sarvam: {
    label: "Sarvam AI",
    baseUrl: "https://api.sarvam.ai/v1",
    tokenEnv: ["SARVAM_API_KEY"],
  },
  scaleway: {
    label: "Scaleway",
    baseUrl: "https://api.scaleway.ai/v1",
    tokenEnv: ["SCALEWAY_API_KEY"],
  },
  siliconflow: {
    label: "SiliconFlow",
    baseUrl: "https://api.siliconflow.com/v1",
    tokenEnv: ["SILICONFLOW_API_KEY"],
  },
  "siliconflow-cn": {
    label: "SiliconFlow (China)",
    baseUrl: "https://api.siliconflow.cn/v1",
    tokenEnv: ["SILICONFLOW_CN_API_KEY"],
  },
  stackit: {
    label: "STACKIT",
    baseUrl: "https://api.openai-compat.model-serving.eu01.onstackit.cloud/v1",
    tokenEnv: ["STACKIT_API_KEY"],
  },
  stepfun: {
    label: "StepFun",
    baseUrl: "https://api.stepfun.com/v1",
    tokenEnv: ["STEPFUN_API_KEY"],
  },
  "stepfun-ai": {
    label: "StepFun AI",
    baseUrl: "https://api.stepfun.ai/step_plan/v1",
    tokenEnv: ["STEPFUN_API_KEY"],
  },
  submodel: {
    label: "submodel",
    baseUrl: "https://llm.submodel.ai/v1",
    tokenEnv: ["SUBMODEL_INSTAGEN_ACCESS_KEY"],
  },
  synthetic: {
    label: "Synthetic",
    baseUrl: "https://api.synthetic.new/openai/v1",
    tokenEnv: ["SYNTHETIC_API_KEY"],
  },
  "tencent-coding-plan": {
    label: "Tencent Coding Plan (China)",
    baseUrl: "https://api.lkeap.cloud.tencent.com/coding/v3",
    tokenEnv: ["TENCENT_CODING_PLAN_API_KEY"],
  },
  "tencent-tokenhub": {
    label: "Tencent TokenHub",
    baseUrl: "https://tokenhub.tencentmaas.com/v1",
    tokenEnv: ["TENCENT_TOKENHUB_API_KEY"],
  },
  "the-grid-ai": {
    label: "The Grid AI",
    baseUrl: "https://api.thegrid.ai/v1",
    tokenEnv: ["THEGRIDAI_API_KEY"],
  },
  "umans-ai": {
    label: "Umans AI",
    baseUrl: "https://api.code.umans.ai/v1",
    tokenEnv: ["UMANS_AI_API_KEY"],
  },
  "umans-ai-coding-plan": {
    label: "Umans AI Coding Plan",
    baseUrl: "https://api.code.umans.ai/v1",
    tokenEnv: ["UMANS_AI_CODING_PLAN_API_KEY"],
  },
  upstage: {
    label: "Upstage",
    baseUrl: "https://api.upstage.ai/v1/solar",
    tokenEnv: ["UPSTAGE_API_KEY"],
  },
  vivgrid: {
    label: "Vivgrid",
    baseUrl: "https://api.vivgrid.com/v1",
    tokenEnv: ["VIVGRID_API_KEY"],
  },
  vultr: {
    label: "Vultr",
    baseUrl: "https://api.vultrinference.com/v1",
    tokenEnv: ["VULTR_API_KEY"],
  },
  "wafer.ai": {
    label: "Wafer",
    baseUrl: "https://pass.wafer.ai/v1",
    tokenEnv: ["WAFER_API_KEY"],
  },
  wandb: {
    label: "Weights & Biases",
    baseUrl: "https://api.inference.wandb.ai/v1",
    tokenEnv: ["WANDB_API_KEY"],
  },
  xiaomi: {
    label: "Xiaomi",
    baseUrl: "https://api.xiaomimimo.com/v1",
    tokenEnv: ["XIAOMI_API_KEY"],
  },
  "xiaomi-token-plan-ams": {
    label: "Xiaomi Token Plan (Europe)",
    baseUrl: "https://token-plan-ams.xiaomimimo.com/v1",
    tokenEnv: ["XIAOMI_API_KEY"],
  },
  "xiaomi-token-plan-cn": {
    label: "Xiaomi Token Plan (China)",
    baseUrl: "https://token-plan-cn.xiaomimimo.com/v1",
    tokenEnv: ["XIAOMI_API_KEY"],
  },
  "xiaomi-token-plan-sgp": {
    label: "Xiaomi Token Plan (Singapore)",
    baseUrl: "https://token-plan-sgp.xiaomimimo.com/v1",
    tokenEnv: ["XIAOMI_API_KEY"],
  },
  xpersona: {
    label: "Xpersona",
    baseUrl: "https://www.xpersona.co/v1",
    tokenEnv: ["XPERSONA_API_KEY"],
  },
  zeldoc: {
    label: "Zeldoc",
    baseUrl: "https://api.zeldoc.ai/v1",
    tokenEnv: ["ZELDOC_API_KEY"],
  },
  zhipuai: {
    label: "Zhipu AI",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    tokenEnv: ["ZHIPU_API_KEY"],
  },
  "zhipuai-coding-plan": {
    label: "Zhipu AI Coding Plan",
    baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
    tokenEnv: ["ZHIPU_API_KEY"],
  },
  "zai-coding-plan": {
    label: "Z.AI Coding Plan",
    baseUrl: "https://api.z.ai/api/coding/paas/v4",
    tokenEnv: ["ZHIPU_API_KEY"],
  },
  xai: { baseUrl: "https://api.x.ai" },
  groq: { baseUrl: "https://api.groq.com/openai" },
  deepinfra: { baseUrl: "https://api.deepinfra.com/v1/openai" },
  cerebras: { baseUrl: "https://api.cerebras.ai" },
  togetherai: { baseUrl: "https://api.together.ai" },
  perplexity: {
    baseUrl: "https://api.perplexity.ai",
    openAiPathPrefix: "none",
    upstreamMode: "chat/completions",
    compatibilityMode: "chat-completions-bridge",
  },
  "perplexity-agent": {
    baseUrl: "https://api.perplexity.ai/v1",
    upstreamMode: "responses",
    compatibilityMode: "responses",
  },
  venice: { baseUrl: "https://api.venice.ai/api/v1" },
  aihubmix: { baseUrl: "https://aihubmix.com/v1" },
  "merge-gateway": { baseUrl: "https://api-gateway.merge.dev/v1/openai" },
  v0: { baseUrl: "https://api.v0.dev/v1" },
  zenmux: {
    label: "ZenMux",
    baseUrl: "https://zenmux.ai/api/v1",
    tokenEnv: ["ZENMUX_API_KEY"],
  },
};

const ANTHROPIC_SDK_PROVIDER_DEFAULTS: Record<
  string,
  OpenAiCompatibleProviderDefault
> = {
  freemodel: {
    label: "FreeModel",
    baseUrl: "https://cc.freemodel.dev/v1",
    tokenEnv: ["FREEMODEL_API_KEY"],
  },
  "kimi-for-coding": {
    label: "Kimi For Coding",
    baseUrl: "https://api.kimi.com/coding/v1",
    tokenEnv: ["KIMI_API_KEY"],
  },
  minimax: {
    label: "MiniMax (minimax.io)",
    baseUrl: "https://api.minimax.io/anthropic/v1",
    tokenEnv: ["MINIMAX_API_KEY"],
  },
  "minimax-cn": {
    label: "MiniMax (minimaxi.com)",
    baseUrl: "https://api.minimaxi.com/anthropic/v1",
    tokenEnv: ["MINIMAX_API_KEY"],
  },
  "minimax-cn-coding-plan": {
    label: "MiniMax Token Plan (minimaxi.com)",
    baseUrl: "https://api.minimaxi.com/anthropic/v1",
    tokenEnv: ["MINIMAX_API_KEY"],
  },
  "minimax-coding-plan": {
    label: "MiniMax Token Plan (minimax.io)",
    baseUrl: "https://api.minimax.io/anthropic/v1",
    tokenEnv: ["MINIMAX_API_KEY"],
  },
};

const RESOURCE_TEMPLATED_PROVIDER_DEFAULTS: Record<string, ModelsDevProvider> = {
  azure: {
    id: "azure",
    name: "Azure",
    npm: "@ai-sdk/azure",
    env: ["AZURE_RESOURCE_NAME", "AZURE_API_KEY"],
  },
  "azure-cognitive-services": {
    id: "azure-cognitive-services",
    name: "Azure Cognitive Services",
    npm: "@ai-sdk/azure",
    env: [
      "AZURE_COGNITIVE_SERVICES_RESOURCE_NAME",
      "AZURE_COGNITIVE_SERVICES_API_KEY",
    ],
  },
  "cloudflare-ai-gateway": {
    id: "cloudflare-ai-gateway",
    name: "Cloudflare AI Gateway",
    npm: "ai-gateway-provider",
    env: [
      "CLOUDFLARE_API_TOKEN",
      "CLOUDFLARE_ACCOUNT_ID",
      "CLOUDFLARE_GATEWAY_ID",
    ],
  },
  "cloudflare-workers-ai": {
    id: "cloudflare-workers-ai",
    name: "Cloudflare Workers AI",
    npm: "@ai-sdk/openai-compatible",
    api: "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/v1",
    env: ["CLOUDFLARE_ACCOUNT_ID", "CLOUDFLARE_API_KEY"],
  },
  databricks: {
    id: "databricks",
    name: "Databricks",
    npm: "@ai-sdk/openai-compatible",
    api: "https://${DATABRICKS_HOST}/ai-gateway/mlflow/v1",
    env: ["DATABRICKS_HOST", "DATABRICKS_TOKEN"],
  },
  neon: {
    id: "neon",
    name: "Neon",
    npm: "@ai-sdk/openai-compatible",
    api: "${NEON_AI_GATEWAY_BASE_URL}/ai-gateway/mlflow/v1",
    env: ["NEON_AI_GATEWAY_BASE_URL", "NEON_AI_GATEWAY_TOKEN"],
  },
  "snowflake-cortex": {
    id: "snowflake-cortex",
    name: "Snowflake Cortex",
    npm: "@ai-sdk/openai-compatible",
    api: "https://${SNOWFLAKE_ACCOUNT}.snowflakecomputing.com/api/v2/cortex/v1",
    env: ["SNOWFLAKE_ACCOUNT", "SNOWFLAKE_CORTEX_PAT"],
  },
};

const OPENAI_COMPATIBLE_SDK_PACKAGE_DEFAULTS: Record<
  string,
  OpenAiCompatibleProviderDefault
> = {
  "@ai-sdk/openai": {
    upstreamMode: "responses",
    compatibilityMode: "responses",
  },
  "@ai-sdk/alibaba": {
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  },
  "@ai-sdk/cerebras": { baseUrl: "https://api.cerebras.ai/v1" },
  "@ai-sdk/deepinfra": { baseUrl: "https://api.deepinfra.com/v1/openai" },
  "@ai-sdk/groq": { baseUrl: "https://api.groq.com/openai/v1" },
  "@ai-sdk/github-copilot": {
    baseUrl: "https://api.githubcopilot.com",
    tokenEnv: ["GITHUB_TOKEN"],
  },
  "@ai-sdk/perplexity": {
    baseUrl: "https://api.perplexity.ai",
    openAiPathPrefix: "none",
    upstreamMode: "chat/completions",
    compatibilityMode: "chat-completions-bridge",
  },
  "@ai-sdk/togetherai": { baseUrl: "https://api.together.xyz/v1" },
  "@ai-sdk/vercel": { baseUrl: "https://api.v0.dev/v1" },
  "@ai-sdk/xai": { baseUrl: "https://api.x.ai/v1" },
  "@aihubmix/ai-sdk-provider": { baseUrl: "https://aihubmix.com/v1" },
  "merge-gateway-ai-sdk-provider": {
    baseUrl: "https://api-gateway.merge.dev/v1/openai",
  },
  "@openrouter/ai-sdk-provider": { baseUrl: "https://openrouter.ai/api/v1" },
  "venice-ai-sdk-provider": { baseUrl: "https://api.venice.ai/api/v1" },
};

function openAiCompatibleDefaultFromNpm(
  npmPackage: string | undefined,
): OpenAiCompatibleProviderDefault | undefined {
  const npm = String(npmPackage ?? "").trim().toLowerCase();
  return OPENAI_COMPATIBLE_SDK_PACKAGE_DEFAULTS[npm];
}

function firstStringValue(
  source: Record<string, unknown> | undefined,
  keys: string[],
): string | undefined {
  if (!source) return undefined;
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function isLocalHttpBaseUrl(value: string | undefined): boolean {
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "http:" &&
      (parsed.hostname === "127.0.0.1" ||
        parsed.hostname === "localhost" ||
        parsed.hostname === "::1")
    );
  } catch {
    return false;
  }
}

function sourceOptionsCarrySecret(options: Record<string, unknown> | undefined): boolean {
  if (!options) return false;
  for (const key of [
    "apiKey",
    "apikey",
    "api_key",
    "token",
    "accessToken",
    "access_token",
    "bearer",
  ]) {
    if (typeof options[key] === "string" && options[key].trim()) return true;
  }
  const headers = options.headers;
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) {
    return false;
  }
  return Object.entries(headers as Record<string, unknown>).some(
    ([key, value]) =>
      typeof value === "string" &&
      value.trim().length > 0 &&
      ["authorization", "x-api-key", "api-key"].includes(key.toLowerCase()),
  );
}

function providerHeadersFromOptions(
  options: Record<string, unknown> | undefined,
): Record<string, string> | undefined {
  const headers = options?.headers;
  if (!headers || typeof headers !== "object" || Array.isArray(headers)) {
    return undefined;
  }

  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
    const name = key.trim();
    if (!name || DISALLOWED_PROVIDER_OPTION_HEADERS.has(name.toLowerCase())) {
      continue;
    }
    if (typeof value === "string" && value.trim()) {
      out[name] = value.trim();
    }
  }
  return Object.keys(out).length ? out : undefined;
}

function providerRuntimeOptionsFromSource(
  options: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!options) {
    return undefined;
  }

  const out: Record<string, unknown> = {};
  if (typeof options.timeout === "number" || options.timeout === false) {
    out.timeout = options.timeout;
  }
  if (typeof options.chunkTimeout === "number") {
    out.chunkTimeout = options.chunkTimeout;
  }
  if (typeof options.setCacheKey === "boolean") {
    out.setCacheKey = options.setCacheKey;
  }
  return Object.keys(out).length ? out : undefined;
}

function normalizeGithubEnterpriseDomain(value: unknown): string | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const raw = value.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  return raw || undefined;
}

function githubCopilotBaseUrlFromOptions(
  options: Record<string, unknown> | undefined,
  fallback = "https://api.githubcopilot.com",
): string {
  const enterpriseUrl =
    normalizeGithubEnterpriseDomain(options?.enterpriseUrl) ??
    normalizeGithubEnterpriseDomain(options?.enterprise_url) ??
    normalizeGithubEnterpriseDomain(options?.githubEnterpriseUrl) ??
    normalizeGithubEnterpriseDomain(options?.github_enterprise_url);
  return enterpriseUrl ? `https://copilot-api.${enterpriseUrl}` : fallback;
}

function tokenEnvHasSecret(
  tokenEnv: string[],
  env: Record<string, string | undefined> = process.env,
): boolean {
  return tokenEnv.some((name) => Boolean(env[name]?.trim()));
}

function expandEnvTemplates(
  value: string,
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  let missing = false;
  const expanded = value
    .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name) => {
      const found = env[String(name)];
      if (found === undefined || found === "") {
        missing = true;
        return "";
      }
      return found;
    })
    .replace(/\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_match, name) => {
      const found = env[String(name)];
      if (found === undefined || found === "") {
        missing = true;
        return "";
      }
      return found;
    });
  return missing ? undefined : expanded;
}

function collapseDuplicateLeadingScheme(value: string): string {
  return value.replace(/^(https?:\/\/)(https?:\/\/)/i, "$2");
}

export function cloudflareAiGatewayBaseUrlFromOptions(
  options: Record<string, unknown> | undefined = {},
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const explicit = firstStringValue(options, [
    "baseURL",
    "baseUrl",
    "base_url",
    "url",
    "endpoint",
  ]);
  if (explicit && /^https?:\/\//.test(explicit)) return explicit;

  const accountId =
    firstStringValue(options, [
      "accountId",
      "accountID",
      "account_id",
      "account",
    ]) ?? env.CLOUDFLARE_ACCOUNT_ID;
  const gatewayId =
    firstStringValue(options, [
      "gatewayId",
      "gatewayID",
      "gateway_id",
      "gateway",
    ]) ?? env.CLOUDFLARE_GATEWAY_ID;

  if (!accountId?.trim() || !gatewayId?.trim()) return undefined;
  return `https://gateway.ai.cloudflare.com/v1/${encodeURIComponent(
    accountId.trim(),
  )}/${encodeURIComponent(gatewayId.trim())}/openai`;
}

export function cloudflareWorkersAiBaseUrlFromOptions(
  options: Record<string, unknown> | undefined = {},
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const explicit = firstStringValue(options, [
    "baseURL",
    "baseUrl",
    "base_url",
    "url",
    "endpoint",
  ]);
  if (explicit && /^https?:\/\//.test(explicit)) return explicit;

  const accountId =
    firstStringValue(options, [
      "accountId",
      "accountID",
      "account_id",
      "account",
    ]) ?? env.CLOUDFLARE_ACCOUNT_ID;

  if (!accountId?.trim()) return undefined;
  return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(
    accountId.trim(),
  )}/ai`;
}

function cloudflareGatewayProviderOptionsFromSource(
  source: ModelsDevProvider,
  env: Record<string, string | undefined> = process.env,
): Record<string, unknown> | undefined {
  const options = source.options ?? {};
  for (const key of ["gatewayId", "gatewayID", "gateway_id", "gateway"]) {
    const value = options[key];
    if (typeof value === "string" && value.trim()) {
      return { gatewayId: value.trim() };
    }
  }
  if (env.CLOUDFLARE_GATEWAY_ID?.trim()) {
    return { gatewayId: env.CLOUDFLARE_GATEWAY_ID.trim() };
  }
  return undefined;
}

const AZURE_OPENAI_PROVIDER_IDS = new Set(["azure", "azure-cognitive-services"]);

function isAzureOpenAiProviderSource(
  providerId: string,
  npmPackage: string | undefined,
): boolean {
  return (
    AZURE_OPENAI_PROVIDER_IDS.has(sanitizeProviderId(providerId)) ||
    String(npmPackage ?? "").trim().toLowerCase() === "@ai-sdk/azure"
  );
}

export function azureOpenAiBaseUrlFromOptions(
  providerId: string,
  options: Record<string, unknown> | undefined = {},
  env: Record<string, string | undefined> = process.env,
  allowCustomProviderId = false,
): string | undefined {
  const id = sanitizeProviderId(providerId);
  if (!allowCustomProviderId && !AZURE_OPENAI_PROVIDER_IDS.has(id)) {
    return undefined;
  }

  const explicit = firstStringValue(options, [
    "baseURL",
    "baseUrl",
    "base_url",
    "url",
    "endpoint",
  ]);
  if (explicit && /^https?:\/\//.test(explicit)) return explicit;

  const resourceName =
    firstStringValue(options, [
      "resourceName",
      "resource_name",
      "resource",
      "resourceId",
      "resource_id",
    ]) ??
    (id === "azure-cognitive-services"
      ? env.AZURE_COGNITIVE_SERVICES_RESOURCE_NAME
      : env.AZURE_RESOURCE_NAME);

  if (!resourceName?.trim()) return undefined;
  if (id === "azure-cognitive-services") {
    return `https://${resourceName.trim()}.cognitiveservices.azure.com/v1`;
  }
  return `https://${resourceName.trim()}.openai.azure.com/openai/v1`;
}

export function amazonBedrockBaseUrlFromOptions(
  options: Record<string, unknown> | undefined = {},
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const explicit = firstStringValue(options, [
    "baseURL",
    "baseUrl",
    "base_url",
    "url",
    "endpoint",
  ]);
  if (explicit && /^https?:\/\//.test(explicit)) return explicit;

  const region =
    firstStringValue(options, ["region", "awsRegion", "aws_region"]) ??
    env.AWS_REGION ??
    env.AWS_DEFAULT_REGION;
  if (!region?.trim()) return undefined;
  return `https://bedrock-runtime.${region.trim()}.amazonaws.com`;
}

export function neonBaseUrlFromOptions(
  options: Record<string, unknown> | undefined = {},
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const explicit = firstStringValue(options, [
    "baseURL",
    "baseUrl",
    "base_url",
    "url",
    "endpoint",
  ]);
  if (explicit && /^https?:\/\//.test(explicit)) return explicit;

  const gatewayBase =
    firstStringValue(options, [
      "NEON_AI_GATEWAY_BASE_URL",
      "neonAiGatewayBaseUrl",
      "neon_ai_gateway_base_url",
      "gatewayBaseUrl",
      "gateway_base_url",
    ]) ?? env.NEON_AI_GATEWAY_BASE_URL;
  if (!gatewayBase?.trim() || !/^https?:\/\//.test(gatewayBase.trim())) {
    return undefined;
  }
  return `${gatewayBase.trim().replace(/\/+$/, "")}/ai-gateway/mlflow/v1`;
}

export function databricksBaseUrlFromOptions(
  options: Record<string, unknown> | undefined = {},
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const explicit = firstStringValue(options, [
    "baseURL",
    "baseUrl",
    "base_url",
    "url",
    "endpoint",
  ]);
  if (explicit && /^https?:\/\//.test(explicit)) return explicit;

  const host =
    firstStringValue(options, [
      "DATABRICKS_HOST",
      "databricksHost",
      "databricks_host",
      "host",
    ]) ?? env.DATABRICKS_HOST;
  if (!host?.trim()) return undefined;
  const trimmed = host.trim();
  const withScheme = /^https?:\/\//.test(trimmed) ? trimmed : `https://${trimmed}`;
  return `${withScheme.replace(/\/+$/, "")}/ai-gateway/mlflow/v1`;
}

export function snowflakeCortexBaseUrlFromOptions(
  options: Record<string, unknown> | undefined = {},
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const explicit = firstStringValue(options, [
    "baseURL",
    "baseUrl",
    "base_url",
    "url",
    "endpoint",
  ]);
  if (explicit && /^https?:\/\//.test(explicit)) return explicit;

  const account =
    firstStringValue(options, [
      "SNOWFLAKE_ACCOUNT",
      "snowflakeAccount",
      "snowflake_account",
      "account",
    ]) ?? env.SNOWFLAKE_ACCOUNT;
  if (!account?.trim()) return undefined;
  return `https://${account.trim()}.snowflakecomputing.com/api/v2/cortex/v1`;
}

export function vertexBaseUrlFromOptions(
  options: Record<string, unknown> | undefined = {},
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const explicit = firstStringValue(options, [
    "baseURL",
    "baseUrl",
    "base_url",
    "url",
    "endpoint",
  ]);
  if (explicit && /^https?:\/\//.test(explicit)) return explicit;

  const project = firstStringValue(options, [
    "project",
    "projectId",
    "projectID",
    "googleCloudProject",
    "google_cloud_project",
    "googleVertexProject",
    "google_vertex_project",
  ]) ?? env.GOOGLE_CLOUD_PROJECT ?? env.GCLOUD_PROJECT ?? env.GOOGLE_VERTEX_PROJECT;
  const location = firstStringValue(options, [
    "location",
    "region",
    "vertexLocation",
    "vertex_location",
    "googleVertexLocation",
    "google_vertex_location",
  ]) ?? env.VERTEX_LOCATION ?? env.GOOGLE_VERTEX_LOCATION;
  const resolvedLocation = location ?? (project?.trim() ? "global" : undefined);
  if (!project?.trim() || !resolvedLocation?.trim()) return undefined;

  const trimmedLocation = resolvedLocation.trim();
  const endpoint = trimmedLocation === "global"
    ? "https://aiplatform.googleapis.com"
    : `https://${trimmedLocation}-aiplatform.googleapis.com`;
  return `${endpoint}/v1/projects/${encodeURIComponent(project.trim())}/locations/${encodeURIComponent(trimmedLocation)}`;
}

function googleVertexProviderOptionsFromSource(
  source: ModelsDevProvider,
): Record<string, unknown> | undefined {
  const options = source.options ?? {};
  const out: Record<string, unknown> = {};
  const project = firstStringValue(options, [
    "project",
    "projectId",
    "projectID",
    "googleCloudProject",
    "google_cloud_project",
    "googleVertexProject",
    "google_vertex_project",
  ]);
  const location = firstStringValue(options, [
    "location",
    "region",
    "vertexLocation",
    "vertex_location",
    "googleVertexLocation",
    "google_vertex_location",
  ]);
  if (project) out.project = project;
  if (location) out.location = location;

  for (const key of [
    "credentialsFile",
    "credentials_file",
    "keyFile",
    "keyfile",
    "keyFilename",
    "key_filename",
    "googleApplicationCredentials",
    "google_application_credentials",
  ]) {
    const value = options[key];
    if (typeof value === "string" && value.trim()) {
      out.credentialsFile = value.trim();
      break;
    }
  }

  for (const key of [
    "googleAuthCredentials",
    "authCredentials",
    "credentials",
    "serviceAccount",
    "service_account",
    "adcCredentials",
    "adc_credentials",
  ]) {
    const value = options[key];
    if (value && (typeof value === "string" || typeof value === "object")) {
      out.googleAuthCredentials = value;
      break;
    }
  }

  return Object.keys(out).length ? out : undefined;
}

function serviceKeyObjectFromUnknown(
  value: unknown,
): Record<string, unknown> | undefined {
  if (!value) return undefined;
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : undefined;
    } catch {
      return undefined;
    }
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return undefined;
}

function sapAiCoreBaseUrlFromServiceKey(
  serviceKey: Record<string, unknown> | undefined,
): string | undefined {
  if (!serviceKey) return undefined;
  const credentials =
    serviceKey.credentials &&
    typeof serviceKey.credentials === "object" &&
    !Array.isArray(serviceKey.credentials)
      ? (serviceKey.credentials as Record<string, unknown>)
      : serviceKey;
  const serviceUrls =
    credentials.serviceurls &&
    typeof credentials.serviceurls === "object" &&
    !Array.isArray(credentials.serviceurls)
      ? (credentials.serviceurls as Record<string, unknown>)
      : {};
  const found =
    firstStringValue(serviceUrls, [
      "AI_API_URL",
      "AI_API_URL_V2",
      "ai_api_url",
      "apiUrl",
    ]) ??
    firstStringValue(credentials, ["aiApiUrl", "ai_api_url", "apiUrl"]);
  return found && /^https?:\/\//.test(found) ? found : undefined;
}

export function sapAiCoreBaseUrlFromOptions(
  options: Record<string, unknown> | undefined = {},
  env: Record<string, string | undefined> = process.env,
): string | undefined {
  const explicit = firstStringValue(options, [
    "baseURL",
    "baseUrl",
    "base_url",
    "endpoint",
    "apiUrl",
    "AI_API_URL",
  ]);
  if (explicit && /^https?:\/\//.test(explicit)) return explicit;

  for (const key of [
    "serviceKey",
    "service_key",
    "aicoreServiceKey",
    "aicore_service_key",
    "apiKey",
    "api_key",
  ]) {
    const fromOption = sapAiCoreBaseUrlFromServiceKey(
      serviceKeyObjectFromUnknown(options[key]),
    );
    if (fromOption) return fromOption;
  }

  return sapAiCoreBaseUrlFromServiceKey(
    serviceKeyObjectFromUnknown(env.AICORE_SERVICE_KEY),
  );
}

function sapAiCoreProviderOptionsFromSource(
  source: ModelsDevProvider,
): Record<string, unknown> | undefined {
  const options = source.options ?? {};
  const out: Record<string, unknown> = {};
  for (const key of [
    "deploymentId",
    "deployment_id",
    "resourceGroup",
    "resource_group",
    "modelVersion",
    "model_version",
  ]) {
    const value = options[key];
    if (typeof value === "string" && value.trim()) out[key] = value.trim();
  }
  return Object.keys(out).length ? out : undefined;
}

function amazonBedrockProviderOptionsFromSource(
  source: ModelsDevProvider,
): Record<string, unknown> | undefined {
  const options = source.options ?? {};
  const out: Record<string, unknown> = {};
  for (const key of [
    "region",
    "awsRegion",
    "aws_region",
    "profile",
    "awsProfile",
    "aws_profile",
    "credentialsFile",
    "credentials_file",
    "sharedCredentialsFile",
    "shared_credentials_file",
  ]) {
    const value = options[key];
    if (typeof value === "string" && value.trim()) out[key] = value.trim();
  }
  return Object.keys(out).length ? out : undefined;
}

let modelsDevCache:
  | { at: number; entries: Map<string, ProviderRegistryEntry> }
  | undefined;

export function sanitizeProviderId(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeBaseUrl(value: unknown): string | undefined {
  const raw = String(value ?? "").trim();
  if (!raw) return undefined;
  const expanded = expandEnvTemplates(raw);
  if (!expanded?.trim()) return undefined;
  const normalized = collapseDuplicateLeadingScheme(expanded);
  const parsed = new URL(normalized);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("base URL must use http or https");
  }
  return normalized.replace(/\/+$/, "");
}

export function normalizeOpenAiCompatibleBaseUrl(value: unknown): string | undefined {
  const normalized = normalizeBaseUrl(value);
  if (!normalized) return undefined;
  return normalized.replace(/\/v1$/i, "");
}

function normalizeNativeProviderBaseUrl(
  adapter: ProviderAdapter,
  value: unknown,
): string | undefined {
  const normalized = normalizeBaseUrl(value);
  if (!normalized) return undefined;
  if (adapter === "anthropic") return normalized.replace(/\/v1$/i, "");
  if (adapter === "google") return normalized.replace(/\/v1(?:beta)?$/i, "");
  if (adapter === "cohere") return normalized.replace(/\/v2$/i, "");
  return normalized;
}

export function providerAdapterFromNpm(
  providerId: string,
  npmPackage?: string,
): ProviderAdapter {
  const id = sanitizeProviderId(providerId);
  const npm = String(npmPackage ?? "").trim().toLowerCase();

  if (id === "openai-chatgpt") return "openai";
  if (id === "mistral") return "mistral";
  if (id === "zai") return "zai";
  if (id === "vercel" || npm === "@ai-sdk/gateway") return "gateway";
  if (OPENAI_COMPATIBLE_SDK_PROVIDER_DEFAULTS[id]) {
    return "openai-compatible";
  }
  if (id === "cloudflare-ai-gateway" || npm.includes("ai-gateway-provider")) {
    return "openai-compatible";
  }
  if (openAiCompatibleDefaultFromNpm(npm)) return "openai-compatible";
  if (npm === "@ai-sdk/openai" || npm.includes("openai-compatible")) {
    return "openai-compatible";
  }
  if (npm === "@ai-sdk/github-copilot") return "openai-compatible";
  if (npm === "@openrouter/ai-sdk-provider") return "openai-compatible";
  if (npm === "@ai-sdk/mistral") return "mistral";
  if (npm === "@ai-sdk/anthropic") return "anthropic";
  if (npm === "@ai-sdk/google") return "google";
  if (npm === "@ai-sdk/cohere") return "cohere";
  if (npm === "@ai-sdk/vercel") return "openai-compatible";
  if (npm === "@ai-sdk/azure") return "azure";
  if (npm === "@ai-sdk/amazon-bedrock/mantle") return "openai-compatible";
  if (npm === "@ai-sdk/amazon-bedrock") return "amazon-bedrock";
  if (npm === "@ai-sdk/google-vertex/anthropic") return "vertex-anthropic";
  if (npm === "@ai-sdk/google-vertex") return "vertex";
  if (npm === "gitlab-ai-provider" || npm === "@gitlab/gitlab-ai-provider") {
    return "gitlab";
  }
  if (
    id === "sap-ai-core" ||
    npm.includes("sap-ai-provider") ||
    npm.includes("@sap-ai-sdk")
  ) {
    return "sap-ai-core";
  }
  if (npm.includes("google-vertex")) return "unsupported";
  return "unsupported";
}

export function isRuntimeSupportedProvider(adapter: ProviderAdapter): adapter is RouteProviderId {
  return (
    adapter === "openai" ||
    adapter === "openai-compatible" ||
    adapter === "mistral" ||
    adapter === "zai" ||
    adapter === "anthropic" ||
    adapter === "google" ||
    adapter === "cohere" ||
    adapter === "gateway" ||
    adapter === "amazon-bedrock" ||
    adapter === "vertex" ||
    adapter === "vertex-anthropic" ||
    adapter === "gitlab" ||
    adapter === "sap-ai-core"
  );
}

function tokenEnvForProvider(
  providerId: string,
  adapter: ProviderAdapter,
  env: unknown,
): string[] {
  const sourceEnv = Array.isArray(env)
    ? env.filter((value): value is string => typeof value === "string")
    : [];
  if (providerId === "vercel" || adapter === "gateway") {
    return sourceEnv.length ? sourceEnv : ["AI_GATEWAY_API_KEY"];
  }
  if (providerId === "amazon-bedrock" || adapter === "amazon-bedrock") {
    return [
      "AWS_BEARER_TOKEN_BEDROCK",
      "AWS_ACCESS_KEY_ID",
      "AWS_SECRET_ACCESS_KEY",
      "AWS_SESSION_TOKEN",
      "AWS_PROFILE",
      "AWS_DEFAULT_PROFILE",
      "AWS_REGION",
      "AWS_DEFAULT_REGION",
      "AWS_SHARED_CREDENTIALS_FILE",
    ];
  }
  if (
    providerId === "google-vertex" ||
    providerId === "google-vertex-anthropic" ||
    adapter === "vertex" ||
    adapter === "vertex-anthropic"
  ) {
    return [
      "GOOGLE_VERTEX_ACCESS_TOKEN",
      "GOOGLE_ACCESS_TOKEN",
      "GOOGLE_APPLICATION_CREDENTIALS",
      "GOOGLE_CLOUD_PROJECT",
      "GOOGLE_VERTEX_PROJECT",
      "VERTEX_LOCATION",
      "GOOGLE_VERTEX_LOCATION",
    ];
  }
  if (providerId === "snowflake-cortex") {
    return [
      "SNOWFLAKE_ACCOUNT",
      "SNOWFLAKE_CORTEX_TOKEN",
      "SNOWFLAKE_CORTEX_PAT",
    ];
  }
  if (providerId === "cloudflare-workers-ai") {
    return [
      "CLOUDFLARE_ACCOUNT_ID",
      "CLOUDFLARE_API_KEY",
      "CLOUDFLARE_GATEWAY_ID",
    ];
  }
  if (providerId === "github-copilot") {
    return ["GITHUB_TOKEN", "GITHUB_COPILOT_TOKEN"];
  }
  if (providerId === "sap-ai-core" || adapter === "sap-ai-core") {
    return ["AICORE_SERVICE_KEY"];
  }
  return sourceEnv;
}

function providerForAdapter(
  providerId: string,
  adapter: ProviderAdapter,
): string {
  return isRuntimeSupportedProvider(adapter) ? adapter : sanitizeProviderId(providerId);
}

export function providerRegistryEntryFromMetadata(
  providerId: string,
  source: ModelsDevProvider,
  providerSource: "builtin" | "models.dev" | "manual" = "models.dev",
): ProviderRegistryEntry {
  const id = sanitizeProviderId(source.id || providerId);
  const openAiCompatibleDefault =
    OPENAI_COMPATIBLE_SDK_PROVIDER_DEFAULTS[id] ??
    openAiCompatibleDefaultFromNpm(source.npm);
  const cloudflareAiGatewayBaseUrl =
    id === "cloudflare-ai-gateway"
      ? cloudflareAiGatewayBaseUrlFromOptions(source.options)
      : undefined;
  const cloudflareWorkersAiBaseUrl =
    id === "cloudflare-workers-ai"
      ? cloudflareWorkersAiBaseUrlFromOptions(source.options)
      : undefined;
  const isAzureOpenAiProvider = isAzureOpenAiProviderSource(id, source.npm);
  const azureOpenAiBaseUrl = isAzureOpenAiProvider
    ? azureOpenAiBaseUrlFromOptions(id, source.options, process.env, true)
    : undefined;
  const bedrockBaseUrl =
    id === "amazon-bedrock"
      ? amazonBedrockBaseUrlFromOptions(source.options)
      : undefined;
  const vertexBaseUrl =
    id === "google-vertex" || id === "google-vertex-anthropic"
      ? vertexBaseUrlFromOptions(source.options)
      : undefined;
  const sapBaseUrl =
    id === "sap-ai-core" ? sapAiCoreBaseUrlFromOptions(source.options) : undefined;
  const gatewayBaseUrl =
    id === "vercel" ||
    String(source.npm ?? "").trim().toLowerCase() === "@ai-sdk/gateway"
      ? (source.api ?? DEFAULT_GATEWAY_BASE_URL)
      : undefined;
  const githubCopilotBaseUrl =
    id === "github-copilot" ||
    String(source.npm ?? "").trim().toLowerCase() === "@ai-sdk/github-copilot"
      ? githubCopilotBaseUrlFromOptions(source.options, source.api)
      : undefined;
  const openAiCompatibleBaseUrl =
    source.api ??
    githubCopilotBaseUrl ??
    openAiCompatibleDefault?.baseUrl ??
    cloudflareAiGatewayBaseUrl ??
    cloudflareWorkersAiBaseUrl ??
    azureOpenAiBaseUrl;
  const requiresOpenAiCompatibleEndpoint =
    id === "cloudflare-ai-gateway" ||
    id === "cloudflare-workers-ai" ||
    isAzureOpenAiProvider;
  const adapter =
    requiresOpenAiCompatibleEndpoint
      ? "openai-compatible"
      : providerAdapterFromNpm(id, source.npm);
  const baseUrl =
    adapter === "openai-compatible"
      ? normalizeOpenAiCompatibleBaseUrl(openAiCompatibleBaseUrl)
      : normalizeNativeProviderBaseUrl(
          adapter,
          source.api ??
            (adapter === "anthropic"
              ? "https://api.anthropic.com"
              : adapter === "google"
                ? "https://generativelanguage.googleapis.com"
                : adapter === "cohere"
                  ? "https://api.cohere.com"
                  : adapter === "gateway"
                    ? gatewayBaseUrl
                  : adapter === "amazon-bedrock"
                    ? bedrockBaseUrl
                    : adapter === "vertex" || adapter === "vertex-anthropic"
                    ? vertexBaseUrl
                    : adapter === "gitlab"
                      ? "https://gitlab.com"
                      : adapter === "sap-ai-core"
                        ? sapBaseUrl
                    : undefined),
        );
  const runtimeSupported =
    isRuntimeSupportedProvider(adapter) &&
    ((adapter !== "vertex" && adapter !== "vertex-anthropic") ||
      Boolean(vertexBaseUrl)) &&
    (!requiresOpenAiCompatibleEndpoint || Boolean(baseUrl)) &&
    (adapter !== "openai-compatible" ||
      openAiCompatibleBaseUrl === undefined ||
      Boolean(baseUrl));
  const tokenEnv = tokenEnvForProvider(id, adapter, source.env);
  const authType =
    adapter === "openai-compatible" &&
    isLocalHttpBaseUrl(baseUrl) &&
    !sourceOptionsCarrySecret(source.options) &&
    !tokenEnvHasSecret(tokenEnv)
      ? "none"
      : "api-key";
  const adapterProviderOptions =
    adapter === "amazon-bedrock"
      ? amazonBedrockProviderOptionsFromSource(source)
      : adapter === "vertex" || adapter === "vertex-anthropic"
        ? googleVertexProviderOptionsFromSource(source)
      : adapter === "sap-ai-core"
        ? sapAiCoreProviderOptionsFromSource(source)
      : id === "cloudflare-ai-gateway" || id === "cloudflare-workers-ai"
        ? cloudflareGatewayProviderOptionsFromSource(source)
        : undefined;
  const runtimeProviderOptions = providerRuntimeOptionsFromSource(source.options);
  const providerHeaders = providerHeadersFromOptions(source.options);
  const providerOptions = {
    ...(runtimeProviderOptions ?? {}),
    ...(adapterProviderOptions ?? {}),
    ...(providerHeaders ? { headers: providerHeaders } : {}),
  };

  return {
    id,
    providerId: id,
    label: source.name || id,
    provider: providerForAdapter(id, adapter),
    providerAdapter: adapter,
    providerNpm: source.npm,
    providerSource,
    providerDoc: source.doc,
    baseUrl,
    openAiPathPrefix: openAiCompatibleDefault?.openAiPathPrefix,
    upstreamMode:
      adapter === "openai-compatible"
        ? (isAzureOpenAiProvider
          ? "responses"
          : (openAiCompatibleDefault?.upstreamMode ?? "chat/completions"))
        : undefined,
    compatibilityMode:
      adapter === "openai-compatible"
        ? (isAzureOpenAiProvider
          ? "responses"
          : (openAiCompatibleDefault?.compatibilityMode ??
          "chat-completions-bridge")
        )
        : undefined,
    providerOptions: Object.keys(providerOptions).length
      ? providerOptions
      : undefined,
    tokenEnv,
    authType,
    runtimeSupported,
    models:
      source.models && typeof source.models === "object"
        ? source.models
        : undefined,
    modelsCount:
      source.models && typeof source.models === "object"
        ? Object.keys(source.models).length
        : undefined,
  };
}

function fallbackOpenAiCompatibleRegistryEntry(
  providerId: string,
): ProviderRegistryEntry | undefined {
  const id = sanitizeProviderId(providerId);
  const defaults = OPENAI_COMPATIBLE_SDK_PROVIDER_DEFAULTS[id];
  if (!defaults) return undefined;

  return providerRegistryEntryFromMetadata(
    id,
    {
      id,
      name: defaults.label ?? id,
      npm: "@ai-sdk/openai-compatible",
      api: defaults.baseUrl,
      env: defaults.tokenEnv ?? [],
      doc: defaults.providerDoc ?? "https://opencode.ai/docs/providers/",
    },
    "builtin",
  );
}

function fallbackAnthropicRegistryEntry(
  providerId: string,
): ProviderRegistryEntry | undefined {
  const id = sanitizeProviderId(providerId);
  const defaults = ANTHROPIC_SDK_PROVIDER_DEFAULTS[id];
  if (!defaults) return undefined;

  return providerRegistryEntryFromMetadata(
    id,
    {
      id,
      name: defaults.label ?? id,
      npm: "@ai-sdk/anthropic",
      api: defaults.baseUrl,
      env: defaults.tokenEnv ?? [],
      doc: defaults.providerDoc ?? "https://opencode.ai/docs/providers/",
    },
    "builtin",
  );
}

function fallbackResourceTemplatedRegistryEntry(
  providerId: string,
): ProviderRegistryEntry | undefined {
  const id = sanitizeProviderId(providerId);
  const source = RESOURCE_TEMPLATED_PROVIDER_DEFAULTS[id];
  if (!source) return undefined;
  return providerRegistryEntryFromMetadata(id, source, "builtin");
}

function fallbackSdkRegistryEntry(
  providerId: string,
): ProviderRegistryEntry | undefined {
  return (
    fallbackOpenAiCompatibleRegistryEntry(providerId) ??
    fallbackAnthropicRegistryEntry(providerId) ??
    fallbackResourceTemplatedRegistryEntry(providerId)
  );
}

function builtinMap(): Map<string, ProviderRegistryEntry> {
  return new Map(BUILTIN_PROVIDERS.map((entry) => [entry.id, entry]));
}

function mergeBuiltinWithModelsDevEntry(
  builtin: ProviderRegistryEntry,
  modelsDev: ProviderRegistryEntry | undefined,
): ProviderRegistryEntry {
  if (!modelsDev) return builtin;
  const models = modelsDev.models ?? builtin.models;
  const tokenEnv = Array.from(
    new Set([...(builtin.tokenEnv ?? []), ...(modelsDev.tokenEnv ?? [])]),
  );
  return {
    ...modelsDev,
    ...builtin,
    providerDoc: builtin.providerDoc ?? modelsDev.providerDoc,
    providerNpm: builtin.providerNpm ?? modelsDev.providerNpm,
    baseUrl: builtin.baseUrl ?? modelsDev.baseUrl,
    openAiPathPrefix: builtin.openAiPathPrefix ?? modelsDev.openAiPathPrefix,
    upstreamMode: builtin.upstreamMode ?? modelsDev.upstreamMode,
    compatibilityMode: builtin.compatibilityMode ?? modelsDev.compatibilityMode,
    providerOptions: builtin.providerOptions ?? modelsDev.providerOptions,
    tokenEnv,
    runtimeSupported: builtin.runtimeSupported || modelsDev.runtimeSupported,
    models,
    modelsCount: models ? Object.keys(models).length : undefined,
    providerSource: "builtin",
  };
}

async function fetchModelsDevProviders(): Promise<Map<string, ProviderRegistryEntry>> {
  if (modelsDevCache && Date.now() - modelsDevCache.at < 10 * 60_000) {
    return new Map(modelsDevCache.entries);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MODELS_DEV_TIMEOUT_MS);
  try {
    const res = await fetch(MODELS_DEV_API_URL, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`models.dev returned ${res.status}`);
    const json = (await res.json()) as Record<string, ModelsDevProvider>;
    const entries = new Map<string, ProviderRegistryEntry>();
    for (const [key, value] of Object.entries(json)) {
      if (!value || typeof value !== "object") continue;
      try {
        const entry = providerRegistryEntryFromMetadata(key, value, "models.dev");
        entries.set(entry.id, entry);
      } catch {
        // Keep one malformed upstream provider from disabling the whole catalog.
      }
    }
    modelsDevCache = { at: Date.now(), entries };
    return new Map(entries);
  } catch {
    return new Map();
  } finally {
    clearTimeout(timeout);
  }
}

export async function listProviderRegistry(): Promise<ProviderRegistryEntry[]> {
  const merged = await fetchModelsDevProviders();
  for (const [id, entry] of builtinMap()) {
    merged.set(id, mergeBuiltinWithModelsDevEntry(entry, merged.get(id)));
  }
  for (const id of Object.keys(OPENAI_COMPATIBLE_SDK_PROVIDER_DEFAULTS)) {
    if (merged.has(id)) continue;
    const fallback = fallbackSdkRegistryEntry(id);
    if (fallback) merged.set(id, fallback);
  }
  for (const id of Object.keys(ANTHROPIC_SDK_PROVIDER_DEFAULTS)) {
    if (merged.has(id)) continue;
    const fallback = fallbackSdkRegistryEntry(id);
    if (fallback) merged.set(id, fallback);
  }
  for (const id of Object.keys(RESOURCE_TEMPLATED_PROVIDER_DEFAULTS)) {
    if (merged.has(id)) continue;
    const fallback = fallbackSdkRegistryEntry(id);
    if (fallback) merged.set(id, fallback);
  }
  return Array.from(merged.values()).sort((a, b) =>
    a.label.localeCompare(b.label),
  );
}

export async function resolveProviderRegistryEntry(
  providerName: string,
  options: { baseUrl?: string } = {},
): Promise<ProviderRegistryEntry> {
  const rawId = sanitizeProviderId(providerName);
  const canonicalId = PROVIDER_ALIASES[rawId] || rawId;
  const baseUrl = options.baseUrl
    ? normalizeOpenAiCompatibleBaseUrl(options.baseUrl)
    : undefined;
  const builtins = builtinMap();
  const modelsDev = await fetchModelsDevProviders();
  const builtin = builtins.get(canonicalId);
  const found = builtin
    ? mergeBuiltinWithModelsDevEntry(builtin, modelsDev.get(canonicalId))
    : (modelsDev.get(canonicalId) ??
      fallbackSdkRegistryEntry(canonicalId));

  if (found) {
    return {
      ...found,
      baseUrl:
        found.providerAdapter === "openai-compatible"
          ? normalizeOpenAiCompatibleBaseUrl(baseUrl || found.baseUrl)
          : normalizeNativeProviderBaseUrl(
              found.providerAdapter,
              baseUrl || found.baseUrl,
            ),
      providerSource:
        found.providerSource === "builtin" ? "builtin" : "models.dev",
    };
  }

  if (baseUrl) {
    return {
      id: rawId || "openai-compatible",
      providerId: rawId || "openai-compatible",
      label: rawId || "OpenAI-compatible",
      provider: "openai-compatible",
      providerAdapter: "openai-compatible",
      providerNpm: "@ai-sdk/openai-compatible",
      providerSource: "manual",
      baseUrl,
      upstreamMode: "chat/completions",
      compatibilityMode: "chat-completions-bridge",
      tokenEnv: [],
      authType: "api-key",
      runtimeSupported: true,
    };
  }

  return {
    id: rawId || "unknown",
    providerId: rawId || "unknown",
    label: rawId || "Unknown provider",
    provider: rawId || "unknown",
    providerAdapter: "unsupported",
    providerSource: "manual",
    tokenEnv: [],
    authType: "api-key",
    runtimeSupported: false,
  };
}
