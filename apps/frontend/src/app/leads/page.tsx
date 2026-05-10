"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence, useMotionValue, useTransform } from "motion/react";
import type { PanInfo } from "motion/react";
import { z } from "zod";
import { Toaster } from "sonner";
import {
  CopilotChatConfigurationProvider,
  CopilotSidebar,
  useAgent,
  useConfigureSuggestions,
  useDefaultRenderTool,
  useFrontendTool,
} from "@copilotkit/react-core/v2";
import { ThreadsDrawer } from "@/components/threads-drawer";
import drawerStyles from "@/components/threads-drawer/threads-drawer.module.css";
import { ToolFallbackCard } from "@/components/copilot/ToolFallbackCard";

// ── Types ──────────────────────────────────────────────────────────────────

type PR = {
  number: number;
  title: string;
  author: string;
  author_avatar?: string;
  body?: string;
  changed_files?: number;
  created_at?: string;
  updated_at?: string;
  labels?: string[];
  html_url?: string;
  draft?: boolean;
  risk_score?: number;
};

type Repo = { owner: string; name: string };

type AgentState = {
  prs: PR[];
  repo: Repo | null;
  selectedPR: (PR & { files?: unknown[]; additions?: number; deletions?: number }) | null;
  view: "swipe" | "risk-matrix" | "contributor-focus" | "dependency-graph" | "category-group";
  header: { title: string; subtitle: string };
  highlightedPRNumbers: number[];
};

const initialState: AgentState = {
  prs: [],
  repo: null,
  selectedPR: null,
  view: "swipe",
  header: { title: "PRs on Edge", subtitle: "Paste a GitHub repo in the chat to start" },
  highlightedPRNumbers: [],
};

// ── Helpers ────────────────────────────────────────────────────────────────

function mergeAgentState(raw: unknown): AgentState {
  const p = raw && typeof raw === "object" ? (raw as Partial<AgentState>) : {};
  return {
    ...initialState,
    ...p,
    header: { ...initialState.header, ...(p.header ?? {}) },
    prs: p.prs ?? [],
    highlightedPRNumbers: p.highlightedPRNumbers ?? [],
  };
}

function riskColor(score: number) {
  if (score >= 70) return "bg-red-100 text-red-700 border-red-200";
  if (score >= 40) return "bg-amber-100 text-amber-700 border-amber-200";
  return "bg-green-100 text-green-700 border-green-200";
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
}

// ── Sub-components ─────────────────────────────────────────────────────────

function PRCardTile({
  pr,
  highlighted,
  onSelect,
}: {
  pr: PR;
  highlighted: boolean;
  onSelect: (pr: PR) => void;
}) {
  const score = pr.risk_score ?? 0;
  return (
    <button
      onClick={() => onSelect(pr)}
      className={`group flex flex-col gap-2 rounded-xl border p-4 text-left transition-all hover:shadow-md ${
        highlighted
          ? "border-violet-400 bg-violet-50 ring-1 ring-violet-300"
          : "border-border bg-card hover:border-border/80"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-xs text-muted-foreground">#{pr.number}</span>
        <span
          className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${riskColor(score)}`}
        >
          risk {score}
        </span>
      </div>
      <p className="line-clamp-2 text-sm font-medium leading-snug">{pr.title}</p>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
        <img
          src={pr.author_avatar}
          alt={pr.author}
          className="size-4 rounded-full"
          onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
        />
        <span>{pr.author}</span>
        {pr.draft && (
          <span className="rounded bg-muted px-1 py-0.5 text-[10px]">draft</span>
        )}
        {pr.changed_files != null && (
          <span>{pr.changed_files} files</span>
        )}
        {pr.updated_at && <span>{timeAgo(pr.updated_at)}</span>}
      </div>
      {(pr.labels ?? []).length > 0 && (
        <div className="flex flex-wrap gap-1">
          {(pr.labels ?? []).slice(0, 3).map((l) => (
            <span
              key={l}
              className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
            >
              {l}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}

function PRDetailPanel({
  pr,
  onClose,
}: {
  pr: AgentState["selectedPR"];
  onClose: () => void;
}) {
  if (!pr) return null;
  const score = pr.risk_score ?? 0;
  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-mono text-xs text-muted-foreground">#{pr.number}</p>
          <h2 className="mt-0.5 text-base font-semibold leading-snug">{pr.title}</h2>
        </div>
        <button
          onClick={onClose}
          className="rounded p-1 text-muted-foreground hover:bg-muted"
        >
          ✕
        </button>
      </div>
      <div className="flex flex-wrap gap-2 text-[11px]">
        <span className={`rounded-full border px-2 py-0.5 font-semibold ${riskColor(score)}`}>
          risk {score}/100
        </span>
        {pr.additions != null && (
          <span className="text-green-600">+{pr.additions}</span>
        )}
        {pr.deletions != null && (
          <span className="text-red-600">-{pr.deletions}</span>
        )}
        {pr.changed_files != null && (
          <span className="text-muted-foreground">{pr.changed_files} files</span>
        )}
      </div>
      {pr.body && (
        <p className="text-xs leading-relaxed text-muted-foreground line-clamp-6">
          {pr.body}
        </p>
      )}
      {pr.html_url && (
        <a
          href={pr.html_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-violet-600 hover:underline"
        >
          Open on GitHub →
        </a>
      )}
    </div>
  );
}

function RiskSummaryInline({ prs }: { prs: PR[] }) {
  const high = prs.filter((p) => (p.risk_score ?? 0) >= 70).length;
  const med = prs.filter((p) => (p.risk_score ?? 0) >= 40 && (p.risk_score ?? 0) < 70).length;
  const low = prs.filter((p) => (p.risk_score ?? 0) < 40).length;
  const total = prs.length || 1;
  return (
    <div className="my-2 rounded-lg border border-border bg-card p-3 text-xs">
      <p className="mb-2 font-medium text-muted-foreground">Risk distribution</p>
      {[
        { label: "High (≥70)", count: high, color: "bg-red-400" },
        { label: "Medium (40-69)", count: med, color: "bg-amber-400" },
        { label: "Low (<40)", count: low, color: "bg-green-400" },
      ].map(({ label, count, color }) => (
        <div key={label} className="mb-1.5 flex items-center gap-2">
          <div className="w-20 shrink-0 text-muted-foreground">{label}</div>
          <div className="flex-1 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-2 rounded-full ${color}`}
              style={{ width: `${(count / total) * 100}%` }}
            />
          </div>
          <div className="w-5 text-right font-mono">{count}</div>
        </div>
      ))}
    </div>
  );
}

function PRCardInline({ number, title, author, risk_score }: {
  number: number; title: string; author: string; risk_score?: number;
}) {
  const score = risk_score ?? 0;
  return (
    <div className="my-2 flex items-center gap-3 rounded-lg border border-border bg-card p-3">
      <span className="font-mono text-xs text-muted-foreground shrink-0">#{number}</span>
      <p className="flex-1 text-xs font-medium leading-snug line-clamp-1">{title}</p>
      <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${riskColor(score)}`}>
        {score}
      </span>
      <span className="shrink-0 text-[11px] text-muted-foreground">{author}</span>
    </div>
  );
}

// ── View: Swipe ────────────────────────────────────────────────────────────────

// PRCardSwipe — single draggable card, ported from SwiPR with our PR type

type SwipeAction = "approve" | "changes" | "skip";

function PRCardSwipe({
  pr,
  isActive,
  stackIndex,
  highlighted,
  onSwipe,
  onSelect,
}: {
  pr: PR;
  isActive: boolean;
  stackIndex: number;
  highlighted: boolean;
  onSwipe: (action: SwipeAction) => void;
  onSelect: (pr: PR) => void;
}) {
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-200, 0, 200], [-12, 0, 12]);
  const greenOpacity = useTransform(x, [0, 80, 200], [0, 0.15, 0.45]);
  const redOpacity = useTransform(x, [-200, -80, 0], [0.45, 0.15, 0]);

  const scale = isActive ? 1 : 1 - stackIndex * 0.04;
  const translateY = isActive ? 0 : -stackIndex * 10;
  const opacity = isActive ? 1 : stackIndex === 1 ? 0.65 : 0.35;

  const handleDragEnd = (_: unknown, info: PanInfo) => {
    if (Math.abs(info.velocity.x) > 500 || Math.abs(info.offset.x) > 100) {
      onSwipe(info.offset.x > 0 ? "approve" : "changes");
    } else if (info.offset.y > 100 || info.velocity.y > 500) {
      onSwipe("skip");
    }
  };

  const score = pr.risk_score ?? 0;

  return (
    <motion.div
      className="absolute inset-0"
      style={{ scale, y: translateY, opacity, zIndex: 10 - stackIndex }}
      initial={false}
    >
      <motion.div
        className={`relative h-full w-full overflow-hidden rounded-2xl border bg-card cursor-grab active:cursor-grabbing ${
          highlighted ? "border-violet-400 ring-2 ring-violet-300" : "border-border"
        }`}
        style={{ x, y, rotate }}
        drag={isActive}
        dragConstraints={{ left: 0, right: 0, top: 0, bottom: 0 }}
        dragElastic={0.9}
        onDragEnd={handleDragEnd}
        whileDrag={{ boxShadow: "0 20px 40px -10px rgb(0 0 0 / 0.25)" }}
      >
        {/* Approve overlay (right drag → green) */}
        <motion.div
          className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-l from-green-500 to-transparent"
          style={{ opacity: greenOpacity }}
        />
        {/* Changes overlay (left drag → red) */}
        <motion.div
          className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-r from-red-500 to-transparent"
          style={{ opacity: redOpacity }}
        />

        <div className="flex h-full flex-col p-6">
          {/* Top row */}
          <div className="flex items-center gap-3 font-mono text-sm">
            <span className="text-foreground">#{pr.number}</span>
            {pr.draft && (
              <span className="rounded bg-muted px-2 py-0.5 text-[10px] font-medium uppercase text-muted-foreground">
                draft
              </span>
            )}
            {pr.updated_at && (
              <span className="text-muted-foreground">{timeAgo(pr.updated_at)}</span>
            )}
            <span className={`ml-auto rounded border px-2 py-0.5 text-[10px] font-semibold ${riskColor(score)}`}>
              risk {score}
            </span>
          </div>

          {/* Author */}
          <div className="mt-4 flex items-center gap-2">
            <img
              src={pr.author_avatar}
              alt={pr.author}
              className="size-6 rounded-full"
              onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
            />
            <span className="font-mono text-sm text-muted-foreground">@{pr.author}</span>
          </div>

          {/* Title */}
          <h2 className="mt-3 line-clamp-2 text-[22px] font-medium leading-[1.3] text-card-foreground">
            {pr.title}
          </h2>

          {/* Body */}
          {pr.body && (
            <p className="mt-2 line-clamp-3 text-sm leading-relaxed text-muted-foreground">
              {pr.body}
            </p>
          )}

          {/* Labels */}
          {(pr.labels ?? []).length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1">
              {(pr.labels ?? []).map((l) => (
                <span
                  key={l}
                  className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground"
                >
                  {l}
                </span>
              ))}
            </div>
          )}

          {/* Footer */}
          <div className="mt-auto flex items-center gap-4 border-t border-border pt-4 font-mono text-xs text-muted-foreground">
            {pr.changed_files != null && <span>{pr.changed_files} files changed</span>}
            <button
              onClick={(e) => { e.stopPropagation(); onSelect(pr); }}
              className="ml-auto text-violet-600 hover:underline"
            >
              details →
            </button>
            {pr.html_url && (
              <a
                href={pr.html_url}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-foreground"
                onClick={(e) => e.stopPropagation()}
              >
                GitHub ↗
              </a>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function SwipeView({
  prs,
  highlightedPRNumbers,
  onSelect,
}: {
  prs: PR[];
  highlightedPRNumbers: number[];
  onSelect: (pr: PR) => void;
}) {
  const [index, setIndex] = useState(0);

  useEffect(() => { setIndex(0); }, [prs.length]);

  const advance = useCallback(
    (_action: SwipeAction) => {
      if (index >= prs.length) return;
      setIndex((i) => i + 1);
    },
    [index, prs.length],
  );

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Don't steal keys from the chat input or any input/textarea/contenteditable
      const t = e.target as HTMLElement;
      if (
        t instanceof HTMLInputElement ||
        t instanceof HTMLTextAreaElement ||
        t.isContentEditable
      ) return;

      switch (e.key.toLowerCase()) {
        case "j":
        case "arrowright":
          e.preventDefault();
          advance("approve");
          break;
        case "f":
        case "arrowleft":
          e.preventDefault();
          advance("changes");
          break;
        case " ":
        case "arrowdown":
          e.preventDefault();
          advance("skip");
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [advance]);

  if (index >= prs.length && prs.length > 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-4">
        <p className="text-lg font-semibold">All caught up</p>
        <p className="text-sm text-muted-foreground">Reviewed {prs.length} PRs</p>
        <button
          onClick={() => setIndex(0)}
          className="rounded-lg border border-border bg-card px-4 py-2 text-sm font-medium hover:bg-muted"
        >
          Start over
        </button>
      </div>
    );
  }

  const visiblePRs = prs.slice(index, index + 3);

  return (
    <div className="flex flex-1 flex-col items-center gap-4 overflow-hidden">
      <p className="font-mono text-xs text-muted-foreground">
        {Math.min(index + 1, prs.length)} of {prs.length}
      </p>

      {/* Stacked cards */}
      <div className="relative h-[500px] w-full max-w-lg lg:h-[560px]">
        <AnimatePresence mode="popLayout">
          {visiblePRs.map((pr, i) => (
            <motion.div
              key={pr.number}
              className="absolute inset-0"
              initial={{ opacity: 0, scale: 0.9, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.88, transition: { duration: 0.25, type: "spring", stiffness: 300, damping: 30 } }}
            >
              <PRCardSwipe
                pr={pr}
                isActive={i === 0}
                stackIndex={i}
                highlighted={highlightedPRNumbers.includes(pr.number)}
                onSwipe={advance}
                onSelect={onSelect}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* Action buttons — SwiPR style */}
      <div className="grid w-full max-w-lg grid-cols-3 gap-3">
        <button
          onClick={() => advance("changes")}
          className="group flex h-12 items-center justify-center gap-2 rounded-lg border-2 border-red-600 bg-card font-mono text-sm font-medium text-red-600 transition-colors hover:bg-red-600/10"
        >
          <span>✕</span>
          <span>Changes</span>
          <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
            F
          </span>
        </button>
        <button
          onClick={() => advance("skip")}
          className="group flex h-12 items-center justify-center gap-2 rounded-lg border-2 border-border bg-card font-mono text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
        >
          <span>↓</span>
          <span>Skip</span>
          <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
            space
          </span>
        </button>
        <button
          onClick={() => advance("approve")}
          className="group flex h-12 items-center justify-center gap-2 rounded-lg border-2 border-green-500 bg-card font-mono text-sm font-medium text-green-600 transition-colors hover:bg-green-500/10"
        >
          <span>✓</span>
          <span>Approve</span>
          <span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
            J
          </span>
        </button>
      </div>
    </div>
  );
}

// ── View: Risk Matrix ──────────────────────────────────────────────────────────

function RiskMatrixView({
  prs,
  highlightedPRNumbers,
  onSelect,
}: {
  prs: PR[];
  highlightedPRNumbers: number[];
  onSelect: (pr: PR) => void;
}) {
  const high = prs.filter((p) => (p.risk_score ?? 0) >= 70);
  const med = prs.filter((p) => (p.risk_score ?? 0) >= 40 && (p.risk_score ?? 0) < 70);
  const low = prs.filter((p) => (p.risk_score ?? 0) < 40);

  const columns = [
    { label: "High", items: high, header: "bg-red-50 text-red-700 border-red-200", dot: "bg-red-400" },
    { label: "Medium", items: med, header: "bg-amber-50 text-amber-700 border-amber-200", dot: "bg-amber-400" },
    { label: "Low", items: low, header: "bg-green-50 text-green-700 border-green-200", dot: "bg-green-400" },
  ];

  return (
    <div className="flex min-h-0 flex-1 gap-3 overflow-hidden">
      {columns.map(({ label, items, header, dot }) => (
        <div key={label} className="flex min-h-0 flex-1 flex-col gap-2">
          <div className={`flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 ${header}`}>
            <div className={`size-2 rounded-full ${dot}`} />
            <span className="text-sm font-semibold">{label}</span>
            <span className="ml-auto font-mono text-xs opacity-60">{items.length}</span>
          </div>
          <div className="flex flex-col gap-1.5 overflow-y-auto">
            {items.length === 0 && (
              <p className="py-4 text-center text-xs text-muted-foreground/50">None</p>
            )}
            {items.map((pr) => {
              const score = pr.risk_score ?? 0;
              const highlighted = highlightedPRNumbers.includes(pr.number);
              return (
                <button
                  key={pr.number}
                  onClick={() => onSelect(pr)}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-all hover:shadow-sm ${
                    highlighted
                      ? "border-violet-400 bg-violet-50 ring-1 ring-violet-300"
                      : "border-border bg-card hover:border-muted"
                  }`}
                >
                  <span className="shrink-0 font-mono text-[10px] text-muted-foreground">#{pr.number}</span>
                  <span className="min-w-0 flex-1 truncate font-medium">{pr.title}</span>
                  <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${riskColor(score)}`}>
                    {score}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── View: Contributor Focus ────────────────────────────────────────────────────

function ContributorFocusView({
  prs,
  highlightedPRNumbers,
  onSelect,
}: {
  prs: PR[];
  highlightedPRNumbers: number[];
  onSelect: (pr: PR) => void;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, { author: string; avatar?: string; prs: PR[] }>();
    for (const pr of prs) {
      if (!map.has(pr.author)) {
        map.set(pr.author, { author: pr.author, avatar: pr.author_avatar, prs: [] });
      }
      map.get(pr.author)!.prs.push(pr);
    }
    return [...map.values()].sort((a, b) => b.prs.length - a.prs.length);
  }, [prs]);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="flex flex-col gap-8">
        {groups.map((group) => (
          <div key={group.author}>
            <div className="mb-3 flex items-center gap-3">
              {group.avatar ? (
                <img
                  src={group.avatar}
                  alt={group.author}
                  className="size-8 rounded-full"
                  onError={(e) => ((e.target as HTMLImageElement).style.display = "none")}
                />
              ) : (
                <div className="flex size-8 items-center justify-center rounded-full bg-muted text-xs font-bold text-muted-foreground">
                  {group.author[0]?.toUpperCase()}
                </div>
              )}
              <span className="text-sm font-semibold">{group.author}</span>
              <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                {group.prs.length} PR{group.prs.length !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="grid gap-2 pl-11 sm:grid-cols-2 lg:grid-cols-3">
              {group.prs.map((pr) => (
                <PRCardTile
                  key={pr.number}
                  pr={pr}
                  highlighted={highlightedPRNumbers.includes(pr.number)}
                  onSelect={onSelect}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── View: Category Group ──────────────────────────────────────────────────────

const CATEGORY_ORDER = [
  "Security", "Breaking", "Bug Fix", "Feature",
  "Refactor", "Testing", "Maintenance", "CI/CD", "Docs", "Other",
];

const CATEGORY_STYLE: Record<string, { dot: string; header: string }> = {
  Security:    { dot: "bg-red-600",    header: "bg-red-50 text-red-800 border-red-200" },
  Breaking:    { dot: "bg-orange-500", header: "bg-orange-50 text-orange-800 border-orange-200" },
  "Bug Fix":   { dot: "bg-red-400",    header: "bg-red-50 text-red-700 border-red-200" },
  Feature:     { dot: "bg-blue-500",   header: "bg-blue-50 text-blue-700 border-blue-200" },
  Refactor:    { dot: "bg-purple-500", header: "bg-purple-50 text-purple-700 border-purple-200" },
  Testing:     { dot: "bg-cyan-500",   header: "bg-cyan-50 text-cyan-700 border-cyan-200" },
  Maintenance: { dot: "bg-slate-400",  header: "bg-slate-50 text-slate-700 border-slate-200" },
  "CI/CD":     { dot: "bg-indigo-500", header: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  Docs:        { dot: "bg-green-500",  header: "bg-green-50 text-green-700 border-green-200" },
  Other:       { dot: "bg-gray-400",   header: "bg-gray-50 text-gray-600 border-gray-200" },
};

function inferCategory(pr: PR): string {
  const labels = (pr.labels ?? []).map((l) => l.toLowerCase()).join(" ");
  const title = (pr.title ?? "").toLowerCase();

  if (/security|auth|vuln|cve|exploit/.test(labels) || /^security:|^auth:/.test(title)) return "Security";
  if (/breaking/.test(labels) || /breaking.?change|^break/.test(title)) return "Breaking";
  if (/^bug$|^bug\s|hotfix/.test(labels) || /^fix(\(|:|\s)|^bug(\(|:|\s)/.test(title)) return "Bug Fix";
  if (/feature|enhancement/.test(labels) || /^feat(\(|:|\s)|^add(\(|:|\s)|^new(\(|:|\s)/.test(title)) return "Feature";
  if (/refactor/.test(labels) || /^refactor(\(|:|\s)|^cleanup(\(|:|\s)/.test(title)) return "Refactor";
  if (/test/.test(labels) || /^test(\(|:|\s)/.test(title)) return "Testing";
  if (/ci\b|cd\b|deploy|build|workflow|action/.test(labels) || /^ci(\(|:|\s)|^build(\(|:|\s)/.test(title)) return "CI/CD";
  if (/doc|readme/.test(labels) || /^docs?(\(|:|\s)/.test(title)) return "Docs";
  if (/deps|depend|chore|maint|bump|upgrade/.test(labels) || /^chore(\(|:|\s)|^deps(\(|:|\s)|^bump(\(|:|\s)/.test(title)) return "Maintenance";

  return "Other";
}

function CategoryGroupView({
  prs,
  highlightedPRNumbers,
  onSelect,
}: {
  prs: PR[];
  highlightedPRNumbers: number[];
  onSelect: (pr: PR) => void;
}) {
  const groups = useMemo(() => {
    const map = new Map<string, PR[]>();
    for (const pr of prs) {
      const cat = inferCategory(pr);
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(pr);
    }
    const ordered = CATEGORY_ORDER.filter((k) => map.has(k)).map((k) => ({
      category: k,
      prs: map.get(k)!,
    }));
    // any categories not in the fixed order list
    const extra = [...map.entries()]
      .filter(([k]) => !CATEGORY_ORDER.includes(k))
      .map(([k, v]) => ({ category: k, prs: v }));
    return [...ordered, ...extra];
  }, [prs]);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="flex flex-col gap-6">
        {groups.map(({ category, prs: groupPRs }) => {
          const style = CATEGORY_STYLE[category] ?? CATEGORY_STYLE.Other;
          return (
            <div key={category}>
              <div
                className={`mb-3 flex items-center gap-2 rounded-lg border px-3 py-2 ${style.header}`}
              >
                <div className={`size-2 rounded-full ${style.dot}`} />
                <span className="text-sm font-semibold">{category}</span>
                <span className="ml-auto font-mono text-xs opacity-60">{groupPRs.length}</span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {groupPRs.map((pr) => (
                  <PRCardTile
                    key={pr.number}
                    pr={pr}
                    highlighted={highlightedPRNumbers.includes(pr.number)}
                    onSelect={onSelect}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── View: Dependency Graph ────────────────────────────────────────────────────
// Parses #N references from PR bodies to build a directed DAG.
// Layout: Sugiyama-style layers — PRs with no deps on left, dependents rightward.
// Solid arrow = explicit keyword ("depends on / blocked by / requires #N").
// Dashed edge = bare #N mention (weaker signal).
// Independent PRs shown as compact chips below the graph.

const NW = 148; // node width
const NH = 58;  // node height
const CG = 96;  // column gap
const RG = 16;  // row gap
const PAD = 24;

function parsePRDeps(pr: PR, allNums: Set<number>): { hard: number[]; soft: number[] } {
  const text = `${pr.title ?? ""} ${pr.body ?? ""}`;
  const hard = new Set<number>();
  const soft = new Set<number>();

  // Explicit dependency keywords → hard edges
  const hardRe = /(?:depends?\s+on|blocked?\s+by|requires?|needs?|stacked?\s+on|after|part\s+of)\s+#(\d+)/gi;
  let m: RegExpExecArray | null;
  while ((m = hardRe.exec(text)) !== null) {
    const n = parseInt(m[1]);
    if (allNums.has(n) && n !== pr.number) hard.add(n);
  }

  // Bare #N mention → soft edges (skip ones already captured as hard)
  const softRe = /#(\d+)/g;
  while ((m = softRe.exec(text)) !== null) {
    const n = parseInt(m[1]);
    if (allNums.has(n) && n !== pr.number && !hard.has(n)) soft.add(n);
  }

  return { hard: [...hard], soft: [...soft] };
}

function nodeRiskStyle(score: number) {
  if (score >= 70) return { fill: "#fef2f2", stroke: "#dc2626" };
  if (score >= 40) return { fill: "#fffbeb", stroke: "#d97706" };
  return { fill: "#f0fdf4", stroke: "#16a34a" };
}

function DependencyGraphView({
  prs,
  highlightedPRNumbers,
  onSelect,
}: {
  prs: PR[];
  highlightedPRNumbers: number[];
  onSelect: (pr: PR) => void;
}) {
  const allNums = useMemo(() => new Set(prs.map((p) => p.number)), [prs]);

  // deps[N] = { hard: [...], soft: [...] } — numbers that N depends on
  const deps = useMemo(() => {
    const map = new Map<number, { hard: number[]; soft: number[] }>();
    for (const pr of prs) map.set(pr.number, parsePRDeps(pr, allNums));
    return map;
  }, [prs, allNums]);

  // reverseDeps[N] = set of nodes that depend on N (for topo sort)
  const reverseDeps = useMemo(() => {
    const map = new Map<number, Set<number>>();
    for (const pr of prs) map.set(pr.number, new Set());
    for (const [num, { hard, soft }] of deps) {
      for (const dep of [...hard, ...soft]) {
        map.get(dep)?.add(num);
      }
    }
    return map;
  }, [deps, prs]);

  // Kahn's topological layering: layer 0 = nodes with no outgoing deps (can merge immediately)
  const { layers, layerOf } = useMemo(() => {
    const inDeg = new Map<number, number>();
    for (const pr of prs) {
      const { hard, soft } = deps.get(pr.number) ?? { hard: [], soft: [] };
      inDeg.set(pr.number, hard.length + soft.length);
    }
    const layers: number[][] = [];
    const layerOf = new Map<number, number>();
    let queue = prs.filter((p) => (inDeg.get(p.number) ?? 0) === 0).map((p) => p.number);
    const visited = new Set<number>();
    while (queue.length > 0) {
      const li = layers.length;
      layers.push([...queue]);
      for (const n of queue) { visited.add(n); layerOf.set(n, li); }
      const next: number[] = [];
      for (const node of queue) {
        for (const dep of reverseDeps.get(node) ?? []) {
          if (!visited.has(dep)) {
            const nd = (inDeg.get(dep) ?? 1) - 1;
            inDeg.set(dep, nd);
            if (nd === 0) next.push(dep);
          }
        }
      }
      queue = next;
    }
    // anything left (cycles) goes in a final layer
    const remaining = prs.filter((p) => !visited.has(p.number)).map((p) => p.number);
    if (remaining.length) { layers.push(remaining); remaining.forEach((n) => layerOf.set(n, layers.length - 1)); }
    return { layers, layerOf };
  }, [prs, deps, reverseDeps]);

  // Nodes that have at least one edge
  const connected = useMemo(() => {
    const s = new Set<number>();
    for (const [num, { hard, soft }] of deps) {
      if (hard.length + soft.length > 0) { s.add(num); for (const n of [...hard, ...soft]) s.add(n); }
    }
    return s;
  }, [deps]);

  const independent = useMemo(
    () => prs.filter((p) => !connected.has(p.number)),
    [prs, connected],
  );
  const graphPRs = useMemo(
    () => prs.filter((p) => connected.has(p.number)),
    [prs, connected],
  );

  // Compute positions only for connected PRs, rebucketed by layer
  const positions = useMemo(() => {
    const map = new Map<number, { x: number; y: number }>();
    // Re-layer only connected nodes
    const connectedLayers: number[][] = layers.map((l) => l.filter((n) => connected.has(n))).filter((l) => l.length > 0);
    connectedLayers.forEach((layer, li) => {
      layer.forEach((num, ni) => {
        map.set(num, {
          x: PAD + li * (NW + CG),
          y: PAD + ni * (NH + RG),
        });
      });
    });
    return map;
  }, [layers, connected]);

  const svgW = Math.max(layers.filter((l) => l.some((n) => connected.has(n))).length, 1) * (NW + CG) - CG + PAD * 2;
  const maxConnectedLayerSize = Math.max(...layers.map((l) => l.filter((n) => connected.has(n)).length), 1);
  const svgH = Math.max(maxConnectedLayerSize * (NH + RG) - RG + PAD * 2, NH + PAD * 2);

  // All directed edges among connected nodes
  const edges = useMemo(() => {
    const result: { from: number; to: number; kind: "hard" | "soft" }[] = [];
    for (const [num, { hard, soft }] of deps) {
      if (!connected.has(num)) continue;
      for (const dep of hard) if (connected.has(dep)) result.push({ from: num, to: dep, kind: "hard" });
      for (const dep of soft) if (connected.has(dep)) result.push({ from: num, to: dep, kind: "soft" });
    }
    return result;
  }, [deps, connected]);

  const hardCount = edges.filter((e) => e.kind === "hard").length;
  const softCount = edges.filter((e) => e.kind === "soft").length;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden">
      {/* Legend */}
      <div className="flex shrink-0 flex-wrap items-center gap-4 font-mono text-[11px] text-muted-foreground/70">
        {hardCount > 0 && (
          <span className="flex items-center gap-1.5">
            <svg width="24" height="8"><line x1="0" y1="4" x2="20" y2="4" stroke="#64748b" strokeWidth="1.5" markerEnd="url(#ah-preview)" /><defs><marker id="ah-preview" markerWidth="6" markerHeight="5" refX="5" refY="2.5" orient="auto"><polygon points="0 0,6 2.5,0 5" fill="#64748b" /></marker></defs></svg>
            depends on ({hardCount})
          </span>
        )}
        {softCount > 0 && (
          <span className="flex items-center gap-1.5">
            <svg width="24" height="8"><line x1="0" y1="4" x2="20" y2="4" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="3 2" /></svg>
            mentions ({softCount})
          </span>
        )}
        {independent.length > 0 && (
          <span className="ml-auto">{independent.length} independent</span>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-auto">
        {graphPRs.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border bg-card/50 p-8 text-center">
            <div>
              <p className="text-sm font-medium">No dependencies detected</p>
              <p className="mt-1 text-xs text-muted-foreground">
                No PR bodies reference another open PR with #N.
                Try asking the agent to{" "}
                <span className="font-mono">&quot;find dependent PRs&quot;</span>.
              </p>
            </div>
          </div>
        ) : (
          <div className="overflow-auto rounded-xl border border-border bg-card">
            <svg
              width={svgW}
              height={svgH}
              viewBox={`0 0 ${svgW} ${svgH}`}
              style={{ display: "block", minWidth: svgW }}
            >
              <defs>
                <marker id="arrowhead" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                  <polygon points="0 0,8 3,0 6" fill="#64748b" />
                </marker>
                <marker id="arrowhead-hard" markerWidth="8" markerHeight="6" refX="7" refY="3" orient="auto">
                  <polygon points="0 0,8 3,0 6" fill="#475569" />
                </marker>
              </defs>

              {/* Edges */}
              {edges.map(({ from, to, kind }) => {
                const fp = positions.get(from);
                const tp = positions.get(to);
                if (!fp || !tp) return null;
                const isRight = fp.x < tp.x;
                // Attach to right side if going right, left side if going left
                const x1 = isRight ? fp.x + NW : fp.x;
                const y1 = fp.y + NH / 2;
                const x2 = isRight ? tp.x : tp.x + NW;
                const y2 = tp.y + NH / 2;
                const cx = (x1 + x2) / 2;
                return (
                  <path
                    key={`${from}-${to}`}
                    d={`M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`}
                    fill="none"
                    stroke={kind === "hard" ? "#475569" : "#94a3b8"}
                    strokeWidth={kind === "hard" ? 1.8 : 1.2}
                    strokeDasharray={kind === "soft" ? "4 3" : undefined}
                    markerEnd={kind === "hard" ? "url(#arrowhead-hard)" : "url(#arrowhead)"}
                  />
                );
              })}

              {/* PR nodes */}
              {graphPRs.map((pr) => {
                const pos = positions.get(pr.number);
                if (!pos) return null;
                const score = pr.risk_score ?? 0;
                const { fill, stroke } = nodeRiskStyle(score);
                const hl = highlightedPRNumbers.includes(pr.number);
                const title = pr.title.length > 22 ? pr.title.slice(0, 21) + "…" : pr.title;
                const author = pr.author.length > 18 ? pr.author.slice(0, 17) + "…" : pr.author;
                return (
                  <g key={pr.number} onClick={() => onSelect(pr)} style={{ cursor: "pointer" }}>
                    <rect
                      x={pos.x} y={pos.y} width={NW} height={NH} rx={8}
                      fill={fill}
                      stroke={hl ? "#8b5cf6" : stroke}
                      strokeWidth={hl ? 2.5 : 1.5}
                    />
                    <text x={pos.x + 8} y={pos.y + 17} fontSize={10} fontFamily="monospace" fill="#374151" fontWeight="700">
                      #{pr.number}
                      <tspan fill="#6b7280" fontWeight="400" fontSize={9}> · {score}</tspan>
                    </text>
                    <text x={pos.x + 8} y={pos.y + 31} fontSize={9} fontFamily="sans-serif" fill="#374151">
                      {title}
                    </text>
                    <text x={pos.x + 8} y={pos.y + 46} fontSize={8} fontFamily="monospace" fill="#94a3b8">
                      @{author}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        )}

        {/* Independent PRs — compact chip row */}
        {independent.length > 0 && (
          <div>
            <p className="mb-2 font-mono text-[11px] text-muted-foreground/60">
              Independent ({independent.length}) — no cross-references detected
            </p>
            <div className="flex flex-wrap gap-2">
              {independent.map((pr) => {
                const score = pr.risk_score ?? 0;
                const hl = highlightedPRNumbers.includes(pr.number);
                return (
                  <button
                    key={pr.number}
                    onClick={() => onSelect(pr)}
                    className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-left text-xs transition-all hover:shadow-sm ${
                      hl
                        ? "border-violet-400 bg-violet-50 ring-1 ring-violet-300"
                        : "border-border bg-card hover:border-muted"
                    }`}
                  >
                    <span className="font-mono text-[10px] text-muted-foreground">#{pr.number}</span>
                    <span className="max-w-[140px] truncate font-medium">{pr.title}</span>
                    <span className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold ${riskColor(score)}`}>
                      {score}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Main canvas ────────────────────────────────────────────────────────────

function CanvasInner() {
  const { agent } = useAgent();

  // Don't memoize — agent.state is mutated in place, so useMemo([agent?.state])
  // won't re-trigger. useAgent() re-renders on OnStateChanged; re-merge each time.
  const state = mergeAgentState(agent?.state);

  const updateState = useCallback(
    (updater: (prev: AgentState) => AgentState) => {
      agent?.setState(updater(mergeAgentState(agent?.state)));
    },
    [agent],
  );

  useConfigureSuggestions({
    available: "before-first-message",
    suggestions: [
      {
        title: "Load a repo",
        message: "Load the open PRs for resend/resend-node",
      },
      {
        title: "Show risky PRs",
        message: "Highlight the high-risk PRs",
      },
      {
        title: "Switch to risk matrix",
        message: "Switch to risk-matrix view",
      },
      {
        title: "Contributor check",
        message: "Who are the most active contributors?",
      },
    ],
  });

  // ── Frontend tools ──────────────────────────────────────────────────────

  useFrontendTool({
    name: "setHeader",
    description: "Update the workspace heading.",
    parameters: z.object({
      title: z.string().optional(),
      subtitle: z.string().optional(),
    }),
    handler: async ({ title, subtitle }) => {
      updateState((prev) => ({
        ...prev,
        header: {
          title: title ?? prev.header.title,
          subtitle: subtitle ?? prev.header.subtitle,
        },
      }));
      return "header updated";
    },
  });

  useFrontendTool({
    name: "setView",
    description: "Switch the canvas view. Values: swipe | risk-matrix | contributor-focus | dependency-graph | category-group",
    parameters: z.object({
      view: z.enum(["swipe", "risk-matrix", "contributor-focus", "dependency-graph", "category-group"]),
    }),
    handler: async ({ view }) => {
      updateState((prev) => ({ ...prev, view }));
      return `view set to ${view}`;
    },
  });

  useFrontendTool({
    name: "selectPR",
    description: "Open or close the PR detail panel. Pass null to deselect.",
    parameters: z.object({ prNumber: z.number().nullable() }),
    handler: async ({ prNumber }) => {
      updateState((prev) => ({
        ...prev,
        selectedPR: prNumber == null
          ? null
          : (prev.prs.find((p) => p.number === prNumber) ?? null),
      }));
      return prNumber ? `selected PR #${prNumber}` : "deselected";
    },
  });

  useFrontendTool({
    name: "highlightPRs",
    description: "Visually highlight specific PRs by number. Pass [] to clear.",
    parameters: z.object({ numbers: z.array(z.number()) }),
    handler: async ({ numbers }) => {
      updateState((prev) => ({ ...prev, highlightedPRNumbers: numbers }));
      return `highlighted ${numbers.length} PRs`;
    },
  });

  useFrontendTool({
    name: "renderPRCard",
    description: "Render an inline PR card in chat when mentioning a specific PR.",
    parameters: z.object({
      number: z.number(),
      title: z.string(),
      author: z.string(),
      risk_score: z.number().optional(),
    }),
    render: ({ args }) => (
      <PRCardInline
        number={args.number ?? 0}
        title={args.title ?? ""}
        author={args.author ?? ""}
        risk_score={args.risk_score}
      />
    ),
  });

  useFrontendTool({
    name: "renderRiskSummary",
    description: "Render an inline risk distribution chart. Reads live PR state.",
    parameters: z.object({}),
    render: () => <RiskSummaryInline prs={mergeAgentState(agent?.state).prs} />,
  });

  useDefaultRenderTool({
    render: ({ name, status, result, parameters }) => (
      <ToolFallbackCard
        name={name}
        status={status}
        result={result}
        parameters={parameters}
      />
    ),
  });

  // ── Sort PRs by risk score descending ────────────────────────────────────

  const sortedPRs = useMemo(
    () => [...state.prs].sort((a, b) => (b.risk_score ?? 0) - (a.risk_score ?? 0)),
    [state.prs],
  );

  const handleSelect = useCallback(
    (p: PR) =>
      updateState((prev) => ({
        ...prev,
        selectedPR: prev.selectedPR?.number === p.number ? null : p,
      })),
    [updateState],
  );

  return (
    <>
      <main className="flex h-screen flex-col gap-4 overflow-hidden bg-background px-6 py-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <div className="flex items-baseline gap-3 flex-1">
            <h1 className="text-lg font-semibold">{state.header.title}</h1>
            <span className="text-sm text-muted-foreground">{state.header.subtitle}</span>
          </div>
          {state.prs.length > 0 && (
            <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/40 p-1">
              {(["swipe", "risk-matrix", "contributor-focus", "dependency-graph", "category-group"] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => updateState((prev) => ({ ...prev, view: v }))}
                  className={`rounded px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    state.view === v
                      ? "bg-background shadow-sm text-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Empty state */}
        {state.prs.length === 0 ? (
          <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border bg-card/50 p-12 text-center">
            <div className="max-w-sm">
              <p className="text-sm text-muted-foreground">
                Type a GitHub repo in the chat to load its open PRs.
              </p>
              <p className="mt-2 font-mono text-xs text-muted-foreground/60">
                e.g. &quot;load PRs for resend/resend-node&quot;
              </p>
            </div>
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 gap-4 overflow-hidden">
            {state.view === "swipe" && (
              <SwipeView
                prs={sortedPRs}
                highlightedPRNumbers={state.highlightedPRNumbers}
                onSelect={handleSelect}
              />
            )}
            {state.view === "risk-matrix" && (
              <RiskMatrixView
                prs={sortedPRs}
                highlightedPRNumbers={state.highlightedPRNumbers}
                onSelect={handleSelect}
              />
            )}
            {state.view === "contributor-focus" && (
              <ContributorFocusView
                prs={sortedPRs}
                highlightedPRNumbers={state.highlightedPRNumbers}
                onSelect={handleSelect}
              />
            )}
            {state.view === "dependency-graph" && (
              <DependencyGraphView
                prs={sortedPRs}
                highlightedPRNumbers={state.highlightedPRNumbers}
                onSelect={handleSelect}
              />
            )}
            {state.view === "category-group" && (
              <CategoryGroupView
                prs={sortedPRs}
                highlightedPRNumbers={state.highlightedPRNumbers}
                onSelect={handleSelect}
              />
            )}

            {state.selectedPR && (
              <div className="w-80 shrink-0">
                <PRDetailPanel
                  pr={state.selectedPR}
                  onClose={() => updateState((prev) => ({ ...prev, selectedPR: null }))}
                />
              </div>
            )}
          </div>
        )}
      </main>

      <CopilotSidebar
        defaultOpen
        width={420}
        input={{ disclaimer: () => null, className: "pb-6" }}
      />

      <Toaster position="bottom-right" />
    </>
  );
}

function HomePage() {
  const [threadId, setThreadId] = useState<string | undefined>(undefined);
  // sessionKey increments every time "New chat" is triggered so the provider
  // remounts even when threadId was already undefined (common on first load —
  // CopilotKit auto-creates a thread internally without updating our state).
  const [sessionKey, setSessionKey] = useState(0);

  const handleThreadChange = useCallback((id: string | undefined) => {
    if (id === undefined) setSessionKey((k) => k + 1);
    setThreadId(id);
  }, []);

  return (
    <div className={drawerStyles.layout}>
      <ThreadsDrawer
        agentId="default"
        threadId={threadId}
        onThreadChange={handleThreadChange}
      />
      <div className={drawerStyles.mainPanel}>
        <CopilotChatConfigurationProvider
          key={threadId ?? sessionKey}
          agentId="default"
          threadId={threadId}
        >
          <CanvasInner />
        </CopilotChatConfigurationProvider>
      </div>
    </div>
  );
}

function ClientOnly({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return <>{children}</>;
}

export default function Page() {
  return (
    <ClientOnly>
      <HomePage />
    </ClientOnly>
  );
}
