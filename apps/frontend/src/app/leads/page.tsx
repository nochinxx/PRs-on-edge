"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  view: "swipe" | "risk-matrix" | "contributor-focus";
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

// ── Main canvas ────────────────────────────────────────────────────────────

function CanvasInner() {
  const { agent } = useAgent();

  function useLiveState() {
    return useMemo(() => mergeAgentState(agent?.state), [agent?.state]);
  }

  const state = useLiveState();

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
    description: "Switch the canvas view. Values: swipe | risk-matrix | contributor-focus",
    parameters: z.object({
      view: z.enum(["swipe", "risk-matrix", "contributor-focus"]),
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

  return (
    <>
      <main className="flex h-screen flex-col gap-4 overflow-hidden bg-background px-6 py-6">
        {/* Header */}
        <div className="flex items-baseline gap-3">
          <h1 className="text-lg font-semibold">{state.header.title}</h1>
          <span className="text-sm text-muted-foreground">{state.header.subtitle}</span>
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
            {/* PR grid */}
            <div className="flex-1 overflow-y-auto">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {sortedPRs.map((pr) => (
                  <PRCardTile
                    key={pr.number}
                    pr={pr}
                    highlighted={state.highlightedPRNumbers.includes(pr.number)}
                    onSelect={(p) =>
                      updateState((prev) => ({
                        ...prev,
                        selectedPR: prev.selectedPR?.number === p.number ? null : p,
                      }))
                    }
                  />
                ))}
              </div>
            </div>

            {/* Detail panel */}
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
  return (
    <div className={drawerStyles.layout}>
      <ThreadsDrawer
        agentId="default"
        threadId={threadId}
        onThreadChange={setThreadId}
      />
      <div className={drawerStyles.mainPanel}>
        <CopilotChatConfigurationProvider agentId="default" threadId={threadId}>
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
