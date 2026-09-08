import { describe, it, expect } from "vitest";
import { buildRequestDetail } from "@/lib/../../open-sse/handlers/chatCore/requestDetail.js";

// P1-D 请求 rationale（route_reason）落库专项单测。

describe("buildRequestDetail 含 route_reason（路由理由落库）", () => {
  it("route_reason 进入详情对象（黑匣子全开）", () => {
    const base = {
      provider: "anthropic",
      model: "claude-sonnet-4-5",
      connectionId: "conn-1",
      latency: { ttft: 12, total: 200 },
      tokens: { prompt_tokens: 10, completion_tokens: 5 },
      request: { messages: [], model: "claude-sonnet-4-5", stream: false },
    };
    const detail = buildRequestDetail(base, {
      route_reason: {
        clientModel: "claude-sonnet-4-5",
        provider: "anthropic",
        model: "claude-sonnet-4-5",
        sourceFormat: "openai",
        targetFormat: "claude",
        alias: "anthropic",
        transport: null,
        stream: false,
        account: "my-acc",
      },
    });
    expect(detail.route_reason).toBeTruthy();
    expect(detail.route_reason.provider).toBe("anthropic");
    expect(detail.route_reason.targetFormat).toBe("claude");
    expect(detail.route_reason.account).toBe("my-acc");
  });

  it("无 route_reason 时字段为 undefined（不破坏旧行为）", () => {
    const detail = buildRequestDetail({
      provider: "openai",
      model: "gpt-4o",
      latency: { ttft: 0, total: 10 },
      tokens: {},
      request: {},
      status: "success",
    });
    expect(detail.route_reason).toBeUndefined();
    // 其它字段完整
    expect(detail.provider).toBe("openai");
    expect(detail.status).toBe("success");
  });

  it("overrides 优先级高于 base（endpoint 覆盖示例）", () => {
    const detail = buildRequestDetail(
      { provider: "p", model: "m", status: "success" },
      { endpoint: "/v1/chat/completions" }
    );
    expect(detail.endpoint).toBe("/v1/chat/completions");
  });
});