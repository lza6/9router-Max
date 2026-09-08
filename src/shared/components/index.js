// Shared Components — 分类聚合导出。
// 保留全部既有导出名，现有 `import { X } from "@/shared/components"` 零破坏。

// ── primitives（基础原子组件）──────────────────────────
export { default as Button } from "./primitives/Button";
export { default as Input } from "./primitives/Input";
export { default as Select } from "./primitives/Select";
export { default as Card } from "./primitives/Card";
export { default as Badge } from "./primitives/Badge";
export { default as Avatar } from "./primitives/Avatar";
export { default as Toggle } from "./primitives/Toggle";
export { default as SegmentedControl } from "./primitives/SegmentedControl";
export { default as Tooltip } from "./primitives/Tooltip";
export { default as Pagination } from "./primitives/Pagination";
export {
  default as Loading,
  Spinner,
  PageLoading,
  Skeleton,
  CardSkeleton,
} from "./primitives/Loading";

// ── modal（弹窗层）────────────────────────────────────
export { default as Modal, ConfirmModal } from "./modal/Modal";
export { default as OAuthModal } from "./modal/OAuthModal";
export { default as ModelSelectModal } from "./modal/ModelSelectModal";
export { default as ManualConfigModal } from "./modal/ManualConfigModal";
export { default as ComboFormModal } from "./modal/ComboFormModal";
export { default as McpMarketplaceModal } from "./modal/McpMarketplaceModal";
export { default as ChangelogModal } from "./modal/ChangelogModal";
export { default as EditConnectionModal } from "./modal/EditConnectionModal";
export { default as AddCustomEmbeddingModal } from "./modal/AddCustomEmbeddingModal";
export { default as DonateModal } from "./modal/DonateModal";
export { default as PricingModal } from "./modal/PricingModal";
export { default as NineRemotePromoModal } from "./modal/NineRemotePromoModal";

// ── auth（OAuth/登录相关）─────────────────────────────
export { default as KiroAuthModal } from "./auth/KiroAuthModal";
export { default as KiroOAuthWrapper } from "./auth/KiroOAuthWrapper";
export { default as KiroSocialOAuthModal } from "./auth/KiroSocialOAuthModal";
export { default as CursorAuthModal } from "./auth/CursorAuthModal";
export { default as IFlowCookieModal } from "./auth/IFlowCookieModal";
export { default as GitLabAuthModal } from "./auth/GitLabAuthModal";

// ── layout（壳层）─────────────────────────────────────
export { default as Sidebar } from "./layout/Sidebar";
export { default as Header } from "./layout/Header";
export { default as Footer } from "./layout/Footer";
export { default as Drawer } from "./layout/Drawer";
export { default as HeaderLanguage } from "./layout/HeaderLanguage";
export { default as HeaderMenu } from "./layout/HeaderMenu";
export { default as LanguageSwitcher } from "./layout/LanguageSwitcher";
export { ThemeProvider } from "./layout/ThemeProvider";
export { default as ThemeToggle } from "./layout/ThemeToggle";

// ── data（数据展示）───────────────────────────────────
export { default as UsageStats } from "./data/UsageStats";
export { default as RequestLogger } from "./data/RequestLogger";
export { default as CapacityBadges } from "./data/CapacityBadges";

// ── provider（供应商侧）───────────────────────────────
export { default as NoAuthProxyCard } from "./provider/NoAuthProxyCard";
export { default as ProviderIcon } from "./provider/ProviderIcon";
export { default as ProviderInfoCard } from "./provider/ProviderInfoCard";
export { default as NineRemoteButton } from "./provider/NineRemoteButton";

// Layouts（兼容旧导出路径）
export * from "./layouts";