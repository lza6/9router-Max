import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getAdapter } from "@/lib/db/driver.js";
import * as requestDetailsRepo from "@/lib/db/repos/requestDetailsRepo.js";

// P1-D：真实 DB 写读 route_reason（黑匣子全开落库）。
describe("route_reason 写库读回（DB 层）", () => {
  let tempDir;
  const originalDataDir = process.env.DATA_DIR;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9r-rr-"));
    process.env.DATA_DIR = tempDir;
    delete global._dbAdapter;
    await getAdapter();
  });

  afterAll(async () => {
    try { global._dbAdapter?.instance?.close?.(); } catch {}
    delete global._dbAdapter;
    if (originalDataDir === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = originalDataDir;
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("saveRequestDetail 写入 route_reason 后 getRequestDetails 可读", async () => {
    const id = "test-route-reason-" + Date.now();
    await requestDetailsRepo.saveRequestDetail({
      id, provider: "anthropic", model: "claude-test", connectionId: "conn-x",
      timestamp: new Date().toISOString(), status: "success",
      latency: { ttft: 5, total: 50 }, tokens: { prompt_tokens: 10, completion_tokens: 5 },
      request: { model: "claude-test", stream: false }, response: { content: "hello" },
      route_reason: { clientModel: "claude-test", provider: "anthropic", model: "claude-test",
        sourceFormat: "openai", targetFormat: "claude", alias: "anthropic", transport: null, stream: false, account: "acc-1" },
    });
    // 显式刷新 buffer（绕过默认 5s flush 间隔）
    await requestDetailsRepo.__test__.flushToDatabase();
    const res = await requestDetailsRepo.getRequestDetails({ page: 1, pageSize: 10 });
    const hit = res.details.find((d) => d.id === id);
    expect(hit).toBeTruthy();
    expect(hit.route_reason).toBeTruthy();
    expect(hit.route_reason.provider).toBe("anthropic");
    expect(hit.route_reason.targetFormat).toBe("claude");
  });
});