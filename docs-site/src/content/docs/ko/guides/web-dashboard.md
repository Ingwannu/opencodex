---
title: 웹 대시보드
description: opencodex GUI — 프록시 상태, 프로바이더 관리, 모델 선택기, 그리고 요청 로그.
---

opencodex는 프록시에서 제공되는 로컬 웹 대시보드(`gui/` 아래의 Vite/React 앱)를 함께 제공합니다. 프로바이더를
추가하고, OAuth로 로그인하고, 서브에이전트 모델을 선택하고, 트래픽을 관찰하는 가장 쉬운 방법입니다.

## 열기

```bash
ocx gui
```

이 명령은 브라우저에서 `http://localhost:<port>`를 엽니다(필요한 경우 먼저 프록시를 자동 시작). 개발 시에는
실행 중인 프록시에 대해 GUI 개발 서버를 별도로 실행할 수 있습니다:

```bash
ocx start
cd gui && bun dev
```

## 할 수 있는 일

| 영역 | 기능 |
| --- | --- |
| **Status** | 실시간 프록시 상태, 포트, 가동 시간, PID. |
| **Providers** | 프로바이더 추가, 편집, 활성화/비활성화, 제거. |
| **Add provider** | 검색 가능한 프리셋 선택기 — OAuth 로그인(xAI / Anthropic / Kimi), ChatGPT forward, API 키 카탈로그(Ollama Cloud 포함), 로컬 서버, 그리고 Custom. |
| **OAuth login** | 프로바이더의 인증 페이지를 열고 토큰이 들어올 때까지 폴링합니다; 또는 기존 로컬 CLI/키체인 토큰을 가져옵니다. |
| **Subagent models** | Codex의 `spawn_agent`가 광고할 라우팅된 모델 ≤5개를 선택합니다. |
| **Models** | 개별 라우팅된 모델을 활성화/비활성화합니다(숨겨진 항목은 카탈로그와 `/v1/models`에서 제외됩니다). |
| **Request log** | 최근 요청(모델, 프로바이더, 상태)을 자동 갱신으로 보여주는 뷰. |

## 대시보드가 프록시와 통신하는 방식

GUI는 프록시의 관리 API에 대한 얇은 클라이언트입니다. 유용한 엔드포인트는 다음과 같습니다(모두 JSON):

| 엔드포인트 | 용도 |
| --- | --- |
| `GET /api/providers` | 설정된 프로바이더 목록. |
| `POST /api/providers` | 프로바이더 추가 또는 덮어쓰기(카탈로그 항목은 자동으로 모델 분류 정보가 보강됩니다). |
| `DELETE /api/providers?name=…` | 프로바이더 제거. |
| `GET /api/key-providers` | API 키 카탈로그(Ollama Cloud 포함). |
| `GET /api/oauth/providers` | 어떤 프로바이더가 OAuth 로그인을 지원하는지. |
| `POST /api/oauth/login` · `GET /api/oauth/status` | OAuth 플로우 시작 및 완료 폴링. |
| `GET` / `PUT /api/subagent-models` | featured 서브에이전트 모델 읽기 / 설정. |

:::tip
대시보드에서 **Ollama Cloud**(또는 임의의 카탈로그 프로바이더)를 추가하면 텍스트 대 비전 모델 분류가
자동으로 설정에 복사되므로, 별도의 수동 설정 없이도 [비전 사이드카](/opencodex/ko/guides/sidecars/)가
올바르게 게이팅됩니다.
:::
