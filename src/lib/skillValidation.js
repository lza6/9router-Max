// 技能质量门禁（P1-B）+ 轻量安全静态扫描（P2-b）。
// 供 /api/skills POST/PUT 与相关单测共用；核心是纯函数，无副作用。

// 触发词：description 必须能表达「何时该触发我」。
// 兼容多语言：匹配动词性词干（中文动作词 / 英文命令式），数量 > 阈值即视为有效。
// 仅当 description 有实际内容（非空）才要求触发词 —— 空描述兼容存量（前端标「待完善」）。
const TRIGGER_MIN = 1;
const TRIGGER_RE = /(生成|翻译|摘要|总结|提取|转换|查询|搜索|创建|改写|润色|审查|检测|发送|绘画|播放|转录|分析|列出|修复|解释|推荐|汇总|调用|执行|推荐|recommend|create|generate|summarize|translate|search|analyze|fix|explain|list|detect|convert|extract|write|send|draw|play|transcribe)/i;

// 结构门禁：SKILL.md 三段式至少要有 2 个 `## ` 小节（Triggering/Execution/Output 或同类）。
const STRUCT_MIN = 2;
const HEADING_RE = /^##\s+/gm;

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

  // —— 结构（content 必填，无则直接 fail —— 由单独字段处理）——
  const headingCount = (String(content).match(HEADING_RE) || []).length;

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

  // —— 安全扫描（硬性，命中即拒绝保存）——
  if (SECRET_RE.test(content)) issues.push({ field: "content", message: "内容疑似包含明文 API 密钥（sk-…）。请改用环境变量占位，不要直接提交密钥。", severity: "secret" });
  if (INLINE_KEY_RE.test(content)) issues.push({ field: "content", message: "内容疑似内联 KEY=… 密钥。请改用环境变量。", severity: "secret" });
  if (PRIVATE_IP_RE.test(content)) issues.push({ field: "content", message: "内容含内网 IP（10./172.16-31./192.168.）。技能内容应面向通用场景，不要硬编码私有地址。", severity: "secret" });
  if (ABS_PATH_RE.test(content)) issues.push({ field: "content", message: "内容含本机绝对路径（/Users/… 或 C:\\Users\\）。请改用相对路径或占位。", severity: "secret" });
  if (LONG_SECRET_STRING_RE.test(content) && !/example|sample|example\.com|placeholder/i.test(content)) {
    issues.push({ field: "content", message: "内容含 40+ 位随机串（疑似 token/密钥）。请移除或改用占位符。", severity: "secret" });
  }

  const hasBlocking = issues.some((i) => i.severity === "error");
  const hasSecret = issues.some((i) => i.severity === "secret");
  const needDescription = !hasDesc;

  return { valid: !hasBlocking && !hasSecret, issues, needDescription, headingCount };
}

// 便捷：给 route 用。返回 message 数组（首个 hard 错误为 400 理由）。
export function skillValidationErrorMessages(input) {
  const r = validateSkillInput(input);
  if (r.valid) return null;
  return r.issues.map((i) => i.message);
}