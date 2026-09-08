import { describe, it, expect } from "vitest";
import { validateSkillInput, skillValidationErrorMessages } from "@/lib/skillValidation";

// P1-B 质量门禁 + P2-b 安全静态扫描 专项单测。

describe("skillValidation（质量门禁 + 安全扫描）", () => {
  it("通过：description 含触发词 + content 含 ≥2 个 ## 小节", () => {
    const r = validateSkillInput({
      description: "生成周报摘要，供团队同步进度",
      content: "## Triggering\n调用前先确认\n## Execution\n1. a\n2. b\n## Output\n报告",
    });
    expect(r.valid).toBe(true);
    expect(r.issues).toHaveLength(0);
  });

  it("拒绝：description 非空但无触发词", () => {
    const r = validateSkillInput({
      description: "这里是技能说明",
      content: "## Triggering\nX\n## Execution\n1",
    });
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.field === "description")).toBe(true);
  });

  it("拒绝：content 小节数 < 2", () => {
    const r = validateSkillInput({
      description: "翻译成英文",
      content: "## Triggering\n只有一小节",
    });
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.field === "content")).toBe(true);
  });

  it("兼容：description 为空放行（needDescription 标记）", () => {
    const r = validateSkillInput({
      description: "",
      content: "## Triggering\nX\n## Execution\n1\n## Output\nY",
    });
    expect(r.valid).toBe(true);
    expect(r.needDescription).toBe(true);
  });

  it("安全：拒绝 sk- 明文 API 密钥", () => {
    const r = validateSkillInput({
      description: "测试",
      content: "## Triggering\nX\n## Execution\n调 API\n## Output\nY\nkey: sk-proj-abcdefghijklmnopqrstuvwxyz1234567890",
    });
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.severity === "secret")).toBe(true);
  });

  it("安全：拒绝内网 IP 硬编码", () => {
    const r = validateSkillInput({
      description: "测试",
      content: "## Triggering\nX\n## Execution\n10.0.0.5\n## Output\nY",
    });
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.severity === "secret")).toBe(true);
  });

  it("安全：拒绝本机绝对路径", () => {
    const r = validateSkillInput({
      description: "测试",
      content: "## Triggering\nX\n## Execution\n记住 C:\\Users\\john\\config\n## Output\nY",
    });
    expect(r.valid).toBe(false);
  });

  it("安全：占位符 example 不误伤", () => {
    // description 用「生成」做触发词；content 里 https://api.example.com 应放行
    const r = validateSkillInput({
      description: "生成测试",
      content: "## Triggering\nX\n## Execution\n用 https://api.example.com\n## Output\nY",
    });
    expect(r.valid).toBe(true);
  });

  it("skillValidationErrorMessages 返回 null 当 valid", () => {
    expect(skillValidationErrorMessages({
      description: "生成摘要",
      content: "## Triggering\n## Execution\n## Output",
    })).toBeNull();
  });
});