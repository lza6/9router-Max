// 技能质量门禁（P1-B）+ 轻量安全静态扫描（P2-b）+ 表达质量建议（P1-A 四要素/负触发/输出契约）。
// 供 /api/skills POST/PUT 与相关单测共用；核心是纯函数，无副作用。
//
// severity 语义（二者互不影响）：
//   "error"  → 硬失败，阻断保存（结构/触发词）
//   "secret" → 硬失败，阻断保存（安全扫描）
// 表达质量建议（负触发/四要素/输出契约）**不进 issues**，单独走 `advisories` 返回，
// 保持 issues「阻断性问题」的既有语义不变；存量技能与既有调用方零影响。

// 触发词：description 必须能表达「何时该触发我」。
// 兼容多语言：匹配动词性词干（中文动作词 / 英文命令式），数量 > 阈值即视为有效。
// 仅当 description 有实际内容（非空）才要求触发词 —— 空描述兼容存量（前端标「待完善」）。
const TRIGGER_MIN = 1;
const TRIGGER_RE = /(生成|翻译|摘要|总结|提取|转换|查询|搜索|创建|改写|润色|审查|检测|发送|绘画|播放|转录|分析|列出|修复|解释|推荐|汇总|调用|执行|推荐|recommend|create|generate|summarize|translate|search|analyze|fix|explain|list|detect|convert|extract|write|send|draw|play|transcribe)/i;

// 结构门禁：SKILL.md 三段式至少要有 2 个 `## ` 小节（Triggering/Execution/Output 或同类）。
const STRUCT_MIN = 2;
const HEADING_RE = /^##\s+/gm;

// —— 表达质量建议（advisory，不阻断）——
// 来源：参考项目 cangjie-skill 的 frontmatter 契约 + soul-sol/claude-md-patterns 的「可绑定规则四要素」。
// 负触发：明确写出「什么时候不该触发我」，显著降低误触发。
const NEGATIVE_TRIGGER_RE = /(不适用|不适用于|不适用场景|不适用性|何时不用|什么时候不用|不要用于|请勿用于|not for|don't use|do not use|not suitable)/i;
// 四要素（可绑定规则）：Trigger / Check / Stop / Evidence —— 有 Check 与 Stop 才算「能验收」。
const HAS_CHECK_RE = /(\bCheck\b|检查|验证|校验|自检|核对)/i;
const HAS_STOP_RE = /(\bStop\b|ABORT|中止|停止条件|放弃条件|回滚|兜底|降级)/i;
const HAS_OUTPUT_RE = /^##\s+(Output|输出|Outputs|结果)/im;
// 一个 `## ` 小节里是否出现了「下一步失败怎么办」之外的第二个要素。

// —— 安全静态扫描（P2-b，基础子集）——
// 1) 明文密钥形态：sk- 开头（OpenAI/Anthropic/多数 AI 厂商），或 env 内联的 KEY=secret
// 2) 私有地址：http://10.|192.168.|172.(1[6-9]|2\d|3[01]) 内网 IP
// 3) 绝对路径泄漏：/Users/|C:\\Users\\ 等
// 4) 明显的 token 长串（32+ 位随机）
const SECRET_RE = /\b[bs]k-[A-Za-z0-9_\-]{16,}\b/;
const INLINE_KEY_RE = /(API_KEY|SECRET|TOKEN|PASSWORD)\s*=\s*['\"]?[A-Za-z0-9_\-]{16,}/i;
const PRIVATE_IP_RE = /(http:\/\/|https:\/\/)?(10|172\.(1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}\b/;
const ABS_PATH_RE = /(\/Users\/[A-Za-z0-9_\-]+|C:\\Users\\)/;
const LONG_SECRET_STRING_RE = /[A-Za-z0-9_\-]{40,}/;

export function validateSkillInput({ description = "", content = "" }) {
  const issues = [];
  const advisories = [];
  const text = String(content || "");

  // —— 结构（content 必填，无则直接 fail —— 由单独字段处理）——
  const headingCount = (text.match(HEADING_RE) || []).length;

  // description 触发词
  const desc = String(description || "");
  const hasDesc = desc.trim().length > 0;
  const hasTrigger = hasDesc && TRIGGER_RE.test(desc);

  if (hasDesc && !hasTrigger) {
    issues.push({
      field: "description",
      message: "description 无触发词（如 生成/翻译/查询/修复…）。加一个动词让 agent 知道何时触发此技能。",
      severity: "error",
    });
  }

  if (headingCount < STRUCT_MIN) {
    issues.push({
      field: "content",
      message: `content 需含至少 ${STRUCT_MIN} 个 "## " 小节（如 ## Triggering / ## Execution / ## Output）。`,
      severity: "error",
    });
  }

  // —— 表达质量建议（advisory：仅提示，**不阻断、不进 issues**）——
  // issues 保持「阻断性问题」的既有语义（error/secret），故建议单独放 advisories。
  if (hasDesc && !NEGATIVE_TRIGGER_RE.test(`${desc}\n${text}`)) {
    advisories.push({
      field: "description",
      message: "建议补充「不适用于/不要用于」负触发，说明什么情况下不该用这个技能——能显著减少误触发。",
      code: "negative-trigger",
    });
  }

  if (headingCount >= STRUCT_MIN) {
    const hasCheck = HAS_CHECK_RE.test(text);
    const hasStop = HAS_STOP_RE.test(text);
    if (!hasCheck || !hasStop) {
      const missing = [!hasCheck ? "Check（怎么验证做对了）" : null, !hasStop ? "Stop（失败/越界时怎么办）" : null].filter(Boolean);
      advisories.push({
        field: "content",
        message: `建议补齐可绑定要素：${missing.join("、")}。只有能被检查、能明确停下的技能才可验收。`,
        code: "bindable-rule",
      });
    }
    if (!HAS_OUTPUT_RE.test(text)) {
      advisories.push({
        field: "content",
        message: '建议补一个 "## Output" 小节，写清技能产出什么（格式/字段/示例），调用方才能稳定消费。',
        code: "output-contract",
      });
    }
  }

  // —— 安全扫描（硬性，命中即拒绝保存）——
  if (SECRET_RE.test(text)) issues.push({ field: "content", message: "内容疑似包含明文 API 密钥（sk-…）。请改用环境变量占位，不要直接提交密钥。", severity: "secret" });
  if (INLINE_KEY_RE.test(text)) issues.push({ field: "content", message: "内容疑似内联 KEY=… 密钥。请改用环境变量。", severity: "secret" });
  if (PRIVATE_IP_RE.test(text)) issues.push({ field: "content", message: "内容含内网 IP（10./172.16-31./192.168.）。技能内容应面向通用场景，不要硬编码私有地址。", severity: "secret" });
  if (ABS_PATH_RE.test(text)) issues.push({ field: "content", message: "内容含本机绝对路径（/Users/… 或 C:\\Users\\）。请改用相对路径或占位。", severity: "secret" });
  if (LONG_SECRET_STRING_RE.test(text) && !/example|sample|example\.com|placeholder/i.test(text)) {
    issues.push({ field: "content", message: "内容含 40+ 位随机串（疑似 token/密钥）。请移除或改用占位符。", severity: "secret" });
  }

  const hasBlocking = issues.some((i) => i.severity === "error");
  const hasSecret = issues.some((i) => i.severity === "secret");
  const needDescription = !hasDesc;

  return { valid: !hasBlocking && !hasSecret, issues, advisories, needDescription, headingCount };
}

// 便捷：给 route 用。返回 message 数组（首个 hard 错误为 400 理由）。
export function skillValidationErrorMessages(input) {
  const r = validateSkillInput(input);
  if (r.valid) return null;
  return r.issues.map((i) => i.message);
}

// 仅返回非阻断的改进建议（供 API 作为 201/200 响应里的 warnings 回给前端展示）。
export function skillValidationWarnings(input) {
  const r = validateSkillInput(input);
  return r.advisories.map((i) => i.message);
}