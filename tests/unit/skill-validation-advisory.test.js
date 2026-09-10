import { describe, it, expect } from "vitest";
import { validateSkillInput, skillValidationWarnings } from "@/lib/skillValidation";

// P1-A 表达质量建议（负触发 / 可绑定四要素 / 输出契约）专项单测。
// 关键契约：advisories 是**非阻断**的，且**不进 issues** —— 存量技能与既有调用方零影响。

const GOOD_BASE = {
  description: "生成周报摘要，供团队同步进度",
  content: "## Triggering\n调用前先确认\n## Execution\n1. a\n2. b\n## Output\n报告",
};

describe("skillValidation 建议（advisory，非阻断）", () => {
  it("合法技能仍然 valid=true 且 issues 为空（advisory 不进 issues）", () => {
    const r = validateSkillInput(GOOD_BASE);
    expect(r.valid).toBe(true);
    expect(r.issues).toHaveLength(0);
  });

  it("缺少负触发时给出 negative-trigger 建议", () => {
    const r = validateSkillInput(GOOD_BASE);
    const codes = r.advisories.map((a) => a.code);
    expect(codes).toContain("negative-trigger");
  });

  it("已写负触发（不适用于）时不再提示 negative-trigger", () => {
    const r = validateSkillInput({
      ...GOOD_BASE,
      content: `${GOOD_BASE.content}\n\n## 不适用于\n信息查询类请求。`,
    });
    expect(r.advisories.map((a) => a.code)).not.toContain("negative-trigger");
  });

  it("已写 Check 与 Stop 时不再提示 bindable-rule", () => {
    const r = validateSkillInput({
      ...GOOD_BASE,
      content:
        "## Triggering\nX\n## Execution\n1. a\n\n## Check\n验证：核对输出字段齐全。\n\n## Stop\nABORT：上游 429 时中止并回滚。\n\n## Output\nJSON",
    });
    expect(r.advisories.map((a) => a.code)).not.toContain("bindable-rule");
  });

  it("缺 Check/Stop 时给出 bindable-rule 建议", () => {
    const r = validateSkillInput({
      description: "生成周报摘要",
      content: "## Triggering\nX\n## Execution\n1. a\n## Output\n报告",
    });
    expect(r.advisories.map((a) => a.code)).toContain("bindable-rule");
  });

  it("补了 ## Output 后不再提示 output-contract", () => {
    const r = validateSkillInput(GOOD_BASE);
    expect(r.advisories.map((a) => a.code)).not.toContain("output-contract");
  });

  it("advisories 不影响 valid：无建议时也为 true", () => {
    const r = validateSkillInput({
      description: "生成周报摘要，供团队同步",
      content:
        "## Triggering\n只用于周报；不适用于日报。\n## Execution\n1. a\n## Check\n验证字段齐全\n## Stop\nABORT：上游失败即中止\n## Output\nMarkdown",
    });
    expect(r.valid).toBe(true);
    expect(r.advisories).toHaveLength(0);
  });

  it("硬错误仍然阻断：security 命中时 valid=false", () => {
    const r = validateSkillInput({
      ...GOOD_BASE,
      content: `${GOOD_BASE.content}\nsk-abcdefghijklmnop1234`,
    });
    expect(r.valid).toBe(false);
    expect(r.issues.some((i) => i.severity === "secret")).toBe(true);
  });

  it("skillValidationWarnings 不依赖 valid：即使技能被拒也返回建议（便于一次性给全反馈）", () => {
    const bad = { description: "无触发词说明", content: "## A\n1" };
    expect(validateSkillInput(bad).valid).toBe(false);
    // 契约：advisories 与 issues 相互独立，valid=false 时仍返回建议。
    const w = skillValidationWarnings(bad);
    expect(Array.isArray(w)).toBe(true);
    expect(w.every((m) => typeof m === "string" && m.length > 0)).toBe(true);
  });

  it("skillValidationWarnings 返回 message 字符串数组", () => {
    const w = skillValidationWarnings(GOOD_BASE);
    expect(Array.isArray(w)).toBe(true);
    expect(w.length).toBeGreaterThan(0);
    expect(w.every((m) => typeof m === "string" && m.length > 0)).toBe(true);
  });

  it("空 description 的存量技能不会被建议逻辑卡住（valid 仍由结构决定）", () => {
    const r = validateSkillInput({ description: "", content: "## A\n1\n## B\n2" });
    expect(r.valid).toBe(true);
    expect(r.advisories.map((a) => a.code)).not.toContain("negative-trigger");
  });
});
