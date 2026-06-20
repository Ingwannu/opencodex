---
title: "사이드카: 웹 검색 및 비전"
description: ChatGPT 로그인으로 gpt-5.4-mini를 빌려 OpenAI가 아닌 모델에게도 실제 웹 검색과 이미지 이해 능력을 부여합니다.
---

일부 기능은 OpenAI의 호스팅 백엔드에만 존재합니다 — 실제 서버 사이드 **웹 검색**과 네이티브
**이미지 입력**이 그것입니다. opencodex는 ChatGPT 로그인(`forward`) 프로바이더를 통해 작은
`gpt-5.4-mini`를 빌려오는 두 개의 사이드카로 *모든* 라우팅된 모델에 이 기능들을 보완합니다. 둘 다 forward
프로바이더가 존재하고 로그인되어 있을 때 **기본적으로 켜져** 있으며, 둘 다 우아하게 저하됩니다 — 실패가 절대
턴을 망가뜨리지 않습니다.

:::note[forward 프로바이더가 필요합니다]
사이드카는 `forward`(ChatGPT 패스스루) 경로를 통해 실행됩니다 — 호스팅 웹 검색과 네이티브 비전을 갖춘
유일한 경로입니다. ChatGPT에 로그인되어 있지 않으면 사이드카는 그냥 건너뛰고 턴이 진행됩니다.
:::

## 웹 검색 사이드카

Codex가 호스팅 `web_search`를 활성화했지만 라우팅된 모델이 OpenAI가 아닌 경우(서버 사이드에서 실행할 수
없음), opencodex는:

1. 호스팅 `web_search` 도구를 **제거하고** 대신 합성 `web_search(query)` **함수** 도구를 라우팅된 모델에
   노출합니다.
2. 모델을 작은 **에이전트 루프**에서 실행합니다. 모델이 `web_search`를 호출하면 opencodex는 forward
   백엔드를 통해 `gpt-5.4-mini`(호스팅 `web_search` 도구, `reasoning.effort: "low"` 사용)를 호출하여
   실제 검색을 수행하고, 스트리밍된 답변 + 인용을 파싱한 뒤 이를 도구 결과로 다시 주입합니다.
3. 모델이 답하거나 `maxSearchesPerTurn`(기본값 3)에 도달할 때까지 **반복**한 뒤 최종 답변을 강제합니다.
   실제 도구 호출(예: `apply_patch`, shell)은 턴을 마무리하여 Codex에 도달합니다.

주입된 결과는 신뢰할 수 없는 데이터 경계로 감싸지고(모델은 그 안의 지시를 따르지 말라는 안내를 받음),
길이가 제한되며, 소스 URL로 중복이 제거됩니다. 구조화된 출력 턴
(`text.format` = json_schema / json_object)에서는 결과가 산문 대신 간결한 JSON으로 전달되어 모델의
스키마 제약 답변을 손상시킬 수 없습니다. 텍스트 전용 라우팅 모델의 경우, 검색 모델은 **관련 이미지를 말로
설명하고** 해당 URL을 포함하도록 안내받습니다.

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

## 비전 사이드카

라우팅된 모델이 텍스트 전용(프로바이더의 `noVisionModels`에 나열됨)이고 요청에 이미지가 포함되어 있으면,
opencodex는 메인 호출 **전에** 각 이미지를 설명하고 이를 텍스트로 대체하여, 텍스트 전용 모델도 이미지에
담긴 내용을 추론할 수 있게 합니다.

- 이미지는 사용자 메시지 **및** 도구 결과(예: Codex의 `view_image`)에서 옵니다.
- 각 이미지는 `gpt-5.4-mini` 비전 모델(`reasoning.effort: "low"`)로 전송되며, 설명이 인라인으로 이미지
  부분을 대체합니다.
- 설명은 **제한된 동시성**(한 번에 3개, 순서 보존)으로 실행되고, 길이가 제한되며, 설명기는
  `max_output_tokens`로 제한됩니다.
- 이미지 URL은 포워딩 전에 검증됩니다: data URL은 약 20 MB 이내의 허용된 이미지 타입
  (`png`/`jpeg`/`webp`/`gif`)이어야 하며, `data:`와 `https:` 스킴만 허용됩니다. (원격
  `https` 이미지는 프록시가 아니라 OpenAI 백엔드가 가져옵니다.)
- `noVisionModels` 매칭은 Ollama 스타일의 `:size` 태그에 관대하므로 `gpt-oss` 항목은
  `gpt-oss:120b`를 포괄합니다.

```json
{
  "visionSidecar": {
    "enabled": true,
    "model": "gpt-5.4-mini",
    "timeoutMs": 45000
  }
}
```

모델은 프로바이더별로 텍스트 전용으로 표시됩니다:

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

## 비활성화

`config.json`에서 두 사이드카 중 하나에 `enabled: false`를 설정하거나, 간단히 forward 프로바이더를 실행하지
마세요. 모든 필드는 [설정 레퍼런스](/opencodex/ko/reference/configuration/#sidecars)를 참고하세요.
