---
title: "Sidecar：Web Search 与 Vision"
description: 通过借用你 ChatGPT 登录下的 gpt-5.4-mini，为非 OpenAI 模型提供真正的 web search 和图像理解能力。
---

某些能力只存在于 OpenAI 的托管后端——真正的服务端 **web search** 和原生**图像输入**。opencodex 通过两个 sidecar 为*任意*路由模型补齐这些能力，它们会借用你 ChatGPT 登录（`forward`）提供商下的一个小型 `gpt-5.4-mini`。当存在 forward 提供商且你已登录时，二者均**默认开启**，并且都会优雅降级——失败绝不会中断本轮对话。

:::note[需要一个 forward 提供商]
sidecar 通过 `forward`（ChatGPT 透传）路径运行——这是唯一具备托管 web search 和原生 vision 的路径。如果你未登录 ChatGPT，sidecar 会直接跳过，本轮对话照常进行。
:::

## Web-search sidecar

当 Codex 启用了托管的 `web_search`，但路由模型是非 OpenAI 模型（无法在服务端运行它）时，opencodex 会：

1. **移除**托管的 `web_search` 工具，转而向路由模型暴露一个合成的 `web_search(query)` **函数**工具。
2. 让模型在一个小型 **agentic 循环**中运行。当它调用 `web_search` 时，opencodex 会通过 forward 后端调用 `gpt-5.4-mini`（带托管的 `web_search` 工具，`reasoning.effort: "low"`）执行一次真实搜索，解析以 streaming 方式返回的答案 + 引用，并将其作为工具结果注入回去。
3. **循环**直到模型给出答案，或达到 `maxSearchesPerTurn`（默认 3），然后强制给出最终答案。真实的工具调用（例如 `apply_patch`、shell）会终结本轮对话，从而到达 Codex。

注入的结果被包裹在一个不可信数据边界中（模型被告知不要遵循其中的指令），长度受限，并按来源 URL 去重。在结构化输出的对话中（`text.format` = json_schema / json_object），结果会以紧凑的 JSON 形式（而非散文）移交，以免破坏模型受 schema 约束的答案。对于纯文本路由模型，搜索模型被告知要**用文字描述相关图像**并附上它们的 URL。

```json
{
  "webSearchSidecar": {
    "enabled": true,
    "model": "gpt-5.4-mini",
    "reasoning": "low",
    "maxSearchesPerTurn": 3,
    "timeoutMs": 30000
  }
}
```

## Vision sidecar

当路由模型为纯文本模型（列在该提供商的 `noVisionModels` 中）且某次请求携带图像时，opencodex 会在主调用**之前**描述每张图像并将其替换为文字，这样纯文本模型仍能对图像内容进行推理。

- 图像来自用户消息**以及**工具结果（例如 Codex 的 `view_image`）。
- 每张图像被发送给一个 `gpt-5.4-mini` vision 模型（`reasoning.effort: "low"`）；其描述就地替换图像部分。
- 描述以**受限并发**运行（一次 3 张，保持顺序），长度受限，且描述器受 `max_output_tokens` 限制。
- 图像 URL 在转发前会被校验：data URL 必须是允许的图像类型（`png`/`jpeg`/`webp`/`gif`）且在约 20 MB 以内；只接受 `data:` 和 `https:` 协议。（远程 `https` 图像由 OpenAI 后端获取，而非由 proxy 获取。）
- `noVisionModels` 的匹配能容忍 Ollama 风格的 `:size` 标签，因此一个 `gpt-oss` 条目可涵盖 `gpt-oss:120b`。

```json
{
  "visionSidecar": {
    "enabled": true,
    "model": "gpt-5.4-mini",
    "timeoutMs": 45000
  }
}
```

模型按提供商被标记为纯文本：

```json
{
  "providers": {
    "ollama-cloud": {
      "adapter": "openai-chat",
      "baseUrl": "https://ollama.com/v1",
      "noVisionModels": ["glm-5.2", "gpt-oss", "qwen3-coder", "deepseek-v4-pro"]
    }
  }
}
```

## 禁用

在 `config.json` 中将任一 sidecar 的 `enabled` 设为 `false`，或干脆不运行 forward 提供商。每个字段请参见 [配置参考](/opencodex/zh-cn/reference/configuration/#sidecars)。
