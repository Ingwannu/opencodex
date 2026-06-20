import { describe, expect, test } from "bun:test";
import { bridgeToResponsesSSE, buildResponseJSON } from "../src/bridge";
import type { AdapterEvent } from "../src/types";

async function* replay(events: AdapterEvent[]): AsyncGenerator<AdapterEvent> {
  for (const event of events) yield event;
}

async function collectSse(stream: ReadableStream<Uint8Array>): Promise<{ event?: string; data: Record<string, unknown> }[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  return text.split("\n\n")
    .map(frame => frame.trim())
    .filter(frame => frame.length > 0 && frame !== "data: [DONE]")
    .map(frame => {
      const lines = frame.split("\n");
      const event = lines.find(line => line.startsWith("event: "))?.slice(7);
      const dataLine = lines.find(line => line.startsWith("data: "));
      return { event, data: JSON.parse(dataLine?.slice(6) ?? "{}") as Record<string, unknown> };
    });
}

describe("Responses bridge reasoning and usage parity", () => {
  test("streaming raw reasoning emits reasoning_text deltas and final raw content", async () => {
    const frames = await collectSse(bridgeToResponsesSSE(replay([
      { type: "reasoning_raw_delta", text: "raw detail" },
      { type: "done", usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 3, reasoningOutputTokens: 2 } },
    ]), "routed/model"));

    const delta = frames.find(f => f.event === "response.reasoning_text.delta")?.data;
    expect(delta).toMatchObject({ content_index: 0, delta: "raw detail" });

    const completed = frames.find(f => f.event === "response.completed")?.data.response as Record<string, unknown>;
    const output = completed.output as Record<string, unknown>[];
    expect(output[0]).toMatchObject({
      type: "reasoning",
      summary: [],
      content: [{ type: "reasoning_text", text: "raw detail" }],
    });
    expect(completed.usage).toMatchObject({
      input_tokens: 10,
      input_tokens_details: { cached_tokens: 3 },
      output_tokens: 5,
      output_tokens_details: { reasoning_tokens: 2 },
      total_tokens: 15,
    });
  });

  test("streaming summary thinking still emits reasoning summary events", async () => {
    const frames = await collectSse(bridgeToResponsesSSE(replay([
      { type: "thinking_delta", thinking: "summary" },
      { type: "done" },
    ]), "routed/model"));

    expect(frames.find(f => f.event === "response.reasoning_summary_text.delta")?.data)
      .toMatchObject({ summary_index: 0, delta: "summary" });
    expect(frames.some(f => f.event === "response.reasoning_text.delta")).toBe(false);
  });

  test("raw reasoning closes before later text output and preserves ordering", async () => {
    const frames = await collectSse(bridgeToResponsesSSE(replay([
      { type: "reasoning_raw_delta", text: "raw" },
      { type: "text_delta", text: "answer" },
      { type: "done" },
    ]), "routed/model"));

    const completed = frames.find(f => f.event === "response.completed")?.data.response as Record<string, unknown>;
    const output = completed.output as Record<string, unknown>[];
    expect(output.map(item => item.type)).toEqual(["reasoning", "message"]);
    expect((output[1].content as Record<string, unknown>[])[0].text).toBe("answer");
  });

  test("raw reasoning closes before later tool calls", async () => {
    const frames = await collectSse(bridgeToResponsesSSE(replay([
      { type: "reasoning_raw_delta", text: "raw" },
      { type: "tool_call_start", id: "call_1", name: "read_file" },
      { type: "tool_call_delta", arguments: "{\"path\":\"README.md\"}" },
      { type: "tool_call_end" },
      { type: "done" },
    ]), "routed/model"));

    const completed = frames.find(f => f.event === "response.completed")?.data.response as Record<string, unknown>;
    const output = completed.output as Record<string, unknown>[];
    expect(output.map(item => item.type)).toEqual(["reasoning", "function_call"]);
    expect(output[1]).toMatchObject({ name: "read_file", arguments: "{\"path\":\"README.md\"}" });
  });

  test("non-streaming JSON includes raw reasoning item and usage details", () => {
    const json = buildResponseJSON([
      { type: "reasoning_raw_delta", text: "raw json" },
      { type: "text_delta", text: "answer" },
      { type: "done", usage: { inputTokens: 4, outputTokens: 6, cachedInputTokens: 1, reasoningOutputTokens: 2 } },
    ], "routed/model");

    const output = json.output as Record<string, unknown>[];
    expect(output.map(item => item.type)).toEqual(["reasoning", "message"]);
    expect(output[0]).toMatchObject({
      content: [{ type: "reasoning_text", text: "raw json" }],
    });
    expect(json.usage).toMatchObject({
      input_tokens_details: { cached_tokens: 1 },
      output_tokens_details: { reasoning_tokens: 2 },
    });
  });
});
