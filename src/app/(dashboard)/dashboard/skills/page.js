"use client";

import { useState, useEffect, useCallback } from "react";
import { Card, Badge, Button } from "@/shared/components";
import { useCopyToClipboard } from "@/shared/hooks/useCopyToClipboard";
import { SKILLS, DEV_SKILL_IDS, SKILLS_REPO_URL, getSkillRawUrl, getSkillBlobUrl } from "@/shared/constants/skills";

// 内置技能常量（GitHub URL）+ 用户自定义技能（/api/skills）双数据源。
function CopyButton({ value, label = "Copy link" }) {
  const { copied, copy } = useCopyToClipboard(2000);
  return (
    <button
      onClick={() => copy(value)}
      className="px-2 py-1 rounded-md bg-primary text-white text-[11px] font-medium hover:bg-primary/90 transition-colors cursor-pointer shrink-0 inline-flex items-center gap-1"
      title={value}
    >
      <span className="material-symbols-outlined text-[12px]">{copied ? "check" : "content_copy"}</span>
      {copied ? "Copied!" : label}
    </button>
  );
}

function BuiltinSkillRow({ skill }) {
  const url = getSkillRawUrl(skill.id);
  return (
    <div
      className={`flex items-start gap-3 p-4 rounded-[14px] border shadow-[var(--shadow-soft)] transition-colors ${
        skill.isEntry ? "border-brand-500/40 bg-brand-500/5" : "border-border-subtle bg-surface hover:bg-surface-2"
      }`}
    >
      <div
        className={`size-9 rounded-lg flex items-center justify-center shrink-0 ${
          skill.isEntry ? "bg-primary text-white" : "bg-primary/10 text-primary"
        }`}
      >
        <span className="material-symbols-outlined text-[18px]">{skill.icon}</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-semibold text-sm text-text-main">{skill.name}</h3>
          {skill.isEntry && <Badge variant="primary" size="sm">START HERE</Badge>}
          {skill.endpoint && (
            <Badge variant="default" size="sm">
              <code className="text-[10px]">{skill.endpoint}</code>
            </Badge>
          )}
        </div>
        <p className="text-xs text-text-muted mt-0.5">{skill.description}</p>
        <a href={getSkillBlobUrl(skill.id)} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">
          SKILL.md
        </a>
      </div>
      <CopyButton value={url} />
    </div>
  );
}

function UserSkillRow({ skill, onDelete, onUse, onReject, deleting, using, rejecting }) {
  const confidencePct = Math.round((skill.confidence || 0.5) * 100);
  return (
    <div className="flex items-start gap-3 p-4 rounded-[14px] border border-border-subtle bg-surface hover:bg-surface-2 transition-colors">
      <div className="size-9 rounded-lg flex items-center justify-center shrink-0 bg-primary/10 text-primary">
        <span className="material-symbols-outlined text-[18px]">workspaces</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <h3 className="font-semibold text-sm text-text-main">{skill.name}</h3>
          {skill.tags?.length > 0 &&
            skill.tags.slice(0, 3).map((t) => (
              <Badge key={t} variant="default" size="sm">
                {t}
              </Badge>
            ))}
        </div>
        {skill.description && <p className="text-xs text-text-muted mt-0.5 line-clamp-2">{skill.description}</p>}
        <div className="flex items-center gap-3 mt-1.5 text-[11px] text-text-muted">
          <span>使用 {skill.uses || 0} 次</span>
          <span>置信度 {confidencePct}%</span>
          {skill.rejectedAt ? <span className="text-amber-600 dark:text-amber-400">（最近标记过「不好使」）</span> : null}
        </div>
        <details className="mt-2">
          <summary className="text-xs text-primary hover:underline cursor-pointer">查看内容</summary>
          <pre className="mt-2 px-3 py-2 rounded bg-surface-2 font-mono text-[11px] text-text-main whitespace-pre-wrap max-h-48 overflow-auto">
            {skill.content}
          </pre>
        </details>
      </div>
      <div className="flex flex-col gap-1 shrink-0">
        <Button size="sm" variant="outline" icon={using ? "progress_activity" : "bolt"} disabled={using || rejecting} onClick={() => onUse(skill.id)}>
          {using ? "使用中…" : "使用一次"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={rejecting ? "progress_activity" : "thumb_down"}
          disabled={rejecting || using}
          onClick={() => onReject(skill.id)}
          title="标记为不好使：置信度降低"
        >
          {rejecting ? "标记中…" : "不好使"}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          icon={deleting ? "progress_activity" : "delete"}
          disabled={deleting}
          onClick={() => onDelete(skill.id)}
        >
          {deleting ? "删除中…" : "删除"}
        </Button>
      </div>
    </div>
  );
}

export default function SkillsPage() {
  const [userSkills, setUserSkills] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({ name: "", description: "", content: "", tags: "" });
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [usingId, setUsingId] = useState(null);
  const [rejectingId, setRejectingId] = useState(null);

  const loadSkills = useCallback(async () => {
    try {
      const res = await fetch("/api/skills", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setUserSkills(Array.isArray(data.skills) ? data.skills : []);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSkills();
  }, [loadSkills]);

  const handleCreate = async (e) => {
    e.preventDefault();
    if (!form.name.trim() || !form.content.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/skills", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.name,
          description: form.description,
          content: form.content,
          tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setForm({ name: "", description: "", content: "", tags: "" });
      setShowCreate(false);
      await loadSkills();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleUse = async (id) => {
    if (usingId) return; // 防重复点击
    setUsingId(id);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/skills/${id}/use`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadSkills();
      setSuccess("已记录一次使用，置信度已提升");
      setTimeout(() => setSuccess(null), 4000);
    } catch (err) {
      setError(err.message);
    } finally {
      setUsingId(null);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("确定删除该技能？")) return;
    if (deletingId) return; // 防重复提交
    setDeletingId(id);
    try {
      const res = await fetch(`/api/skills/${id}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
      // 404 = 已被删除，按幂等成功处理
      await loadSkills();
    } catch (err) {
      setError(err.message);
    } finally {
      setDeletingId(null);
    }
  };

  const handleReject = async (id) => {
    if (rejectingId) return; // 防重复点击
    if (!window.confirm("标记这个技能为「不好使」？置信度会降低。" )) return;
    setRejectingId(id);
    setError(null);
    setSuccess(null);
    try {
      const res = await fetch(`/api/skills/${id}/reject`, { method: "POST" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await loadSkills();
      setSuccess("已标记「不好使」，置信度已降低");
      setTimeout(() => setSuccess(null), 4000);
    } catch (err) {
      setError(err.message);
    } finally {
      setRejectingId(null);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Card padding="md">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h2 className="text-sm font-semibold text-text-main">我的技能</h2>
            <p className="text-xs text-text-muted mt-0.5">
              保存的提示词/工作流技能，越用置信度越高（用得多 = 越信任）。
            </p>
          </div>
          <Button size="sm" icon="add" onClick={() => setShowCreate((v) => !v)}>
            {showCreate ? "取消" : "新建技能"}
          </Button>
        </div>

        {showCreate && (
          <form onSubmit={handleCreate} className="mt-4 space-y-3 border-t border-border-subtle pt-4">
            <div>
              <label className="block text-xs font-medium text-text-main mb-1">名称 *</label>
              <input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                maxLength={100}
                className="w-full px-3 py-2 rounded border border-border-subtle bg-surface-2 text-sm text-text-main"
                placeholder="例如：写小红书文案"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-main mb-1">描述</label>
              <input
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
                className="w-full px-3 py-2 rounded border border-border-subtle bg-surface-2 text-sm text-text-main"
                placeholder="一句话说明这个技能做什么"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-main mb-1">标签（逗号分隔）</label>
              <input
                value={form.tags}
                onChange={(e) => setForm({ ...form, tags: e.target.value })}
                className="w-full px-3 py-2 rounded border border-border-subtle bg-surface-2 text-sm text-text-main"
                placeholder="写作,小红书,文案"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-main mb-1">技能内容（SKILL.md 正文）*</label>
              <textarea
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                rows={5}
                maxLength={20000}
                className="w-full px-3 py-2 rounded border border-border-subtle bg-surface-2 text-sm text-text-main font-mono"
                placeholder="## Triggering\n用户说 X 时用它\n\n## Execution\n1. 先确认 provider/模型\n2. 发请求\n3. 处理响应\n\n## Output\n成功贴出模型ID/路径；失败报告状态+error+查 Console Log"
              />
            </div>
            <div className="flex items-center gap-2">
              <Button type="submit" size="sm" disabled={saving} icon={saving ? "progress_activity" : "save"}>
                {saving ? "保存中…" : "保存技能"}
              </Button>
            </div>
          </form>
        )}

        {error && <p className="mt-3 text-xs text-red-400">加载失败：{error}</p>}
        {success && <p className="mt-3 text-xs text-green-400">{success}</p>}
        {loading ? (
          <p className="mt-3 text-xs text-text-muted">加载中…</p>
        ) : (
          <div className="mt-4 space-y-2">
            {userSkills.length === 0 ? (
              <p className="text-xs text-text-muted">还没有自定义技能，点上方“新建技能”保存第一个。</p>
            ) : (
              userSkills.map((skill) => (
                <UserSkillRow
                  key={skill.id}
                  skill={skill}
                  onUse={handleUse}
                  onReject={handleReject}
                  onDelete={handleDelete}
                  deleting={deletingId === skill.id}
                  using={usingId === skill.id}
                  rejecting={rejectingId === skill.id}
                />
              ))
            )}
          </div>
        )}
      </Card>

      <Card padding="md">
        <div className="text-xs text-text-muted mb-2">Paste this to your AI:</div>
        <div className="px-3 py-2 rounded bg-surface-2 font-mono text-[12px] text-text-main">
          Read this skill and use it: {getSkillRawUrl("9router")}
        </div>
      </Card>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-text-main">内置技能</h2>
        <p className="text-xs text-text-muted -mt-1">复制链接粘贴到你的 AI（Claude/Cursor/任何 agent）即可使用；入口技能包含完整 setup。</p>
        {SKILLS.filter((skill) => !DEV_SKILL_IDS.includes(skill.id)).map((skill) => (
          <BuiltinSkillRow key={skill.id} skill={skill} />
        ))}
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-text-main">开发者技能</h2>
        <p className="text-xs text-text-muted -mt-1">模板与开发 SOP，供创建自定义技能 / 参与仓库开发时参考。</p>
        {SKILLS.filter((skill) => DEV_SKILL_IDS.includes(skill.id)).map((skill) => (
          <BuiltinSkillRow key={skill.id} skill={skill} />
        ))}
      </div>

      <Card padding="md">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold text-text-main">More on GitHub</h2>
            <p className="text-xs text-text-muted mt-0.5">Browse source, README, and examples.</p>
          </div>
          <a
            href={`${SKILLS_REPO_URL}/tree/master/skills`}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-primary hover:underline inline-flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-[16px]">open_in_new</span>
            View on GitHub
          </a>
        </div>
      </Card>
    </div>
  );
}
