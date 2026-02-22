import { useState } from "react";
import {
  McpUseProvider,
  useWidget,
  useWidgetTheme,
  useCallTool,
  type WidgetMetadata,
} from "mcp-use/react";
import { z } from "zod";

// ── Schema ──────────────────────────────────────────────────────────────────

const propsSchema = z.object({
  nodes: z.array(
    z.object({
      name: z.string(),
      type: z.enum(["erlang", "elixir"]),
      status: z.string(),
      startedAt: z.number(),
      processCount: z.number().nullable(),
    })
  ),
});

export const widgetMetadata: WidgetMetadata = {
  description: "Cluster visualization showing BEAM nodes as animated orbs with inline process inspection",
  props: propsSchema,
  exposeAsTool: false,
};

type Props = z.infer<typeof propsSchema>;

// ── Types ───────────────────────────────────────────────────────────────────

interface ProcessInfo {
  name: string;
  status: string;
  messageQueueLen: number;
  memory: number;
  currentFunction: string;
}

interface InspectResult {
  processes: ProcessInfo[];
}

// ── Theme Colors ────────────────────────────────────────────────────────────

function getThemeColors(theme: "light" | "dark") {
  const isDark = theme === "dark";
  return {
    // Surfaces
    bg: isDark ? "#0a0e17" : "#f8fafc",
    surface: isDark ? "#111827" : "#ffffff",
    surfaceHover: isDark ? "#1a2332" : "#f1f5f9",
    surfaceExpanded: isDark ? "#0d1321" : "#f8fafc",
    border: isDark ? "#1e293b" : "#e2e8f0",
    borderLight: isDark ? "#162032" : "#f1f5f9",

    // Text
    text: isDark ? "#e2e8f0" : "#1e293b",
    textSecondary: isDark ? "#94a3b8" : "#64748b",
    textMuted: isDark ? "#64748b" : "#94a3b8",

    // Status glows
    runningGlow: isDark ? "0 0 12px rgba(34,197,94,0.4), 0 0 4px rgba(34,197,94,0.2)" : "0 0 8px rgba(34,197,94,0.3)",
    startingGlow: isDark ? "0 0 12px rgba(234,179,8,0.4), 0 0 4px rgba(234,179,8,0.2)" : "0 0 8px rgba(234,179,8,0.3)",
    errorGlow: isDark ? "0 0 12px rgba(239,68,68,0.5), 0 0 4px rgba(239,68,68,0.3)" : "0 0 8px rgba(239,68,68,0.3)",

    // Status colors
    running: "#22c55e",
    starting: "#eab308",
    error: "#ef4444",
    stopped: isDark ? "#475569" : "#94a3b8",

    // Node type colors
    erlang: isDark ? "#f59e0b" : "#b45309",
    erlangBg: isDark ? "rgba(245,158,11,0.12)" : "#fef3c7",
    elixir: isDark ? "#a78bfa" : "#7c3aed",
    elixirBg: isDark ? "rgba(167,139,250,0.12)" : "#ede9fe",

    // Neon accents
    accent1: isDark ? "#06b6d4" : "#0284c7", // cyan
    accent2: isDark ? "#a855f7" : "#7c3aed", // purple

    // Process pill
    pillBg: isDark ? "#1e293b" : "#f1f5f9",
    pillBorder: isDark ? "#334155" : "#e2e8f0",
    queueWarning: isDark ? "rgba(239,68,68,0.15)" : "rgba(239,68,68,0.08)",
    queueWarningBorder: isDark ? "rgba(239,68,68,0.4)" : "rgba(239,68,68,0.3)",

    // Stats bar
    statsBg: isDark ? "#111827" : "#ffffff",
    statsBorder: isDark ? "#1e293b" : "#e2e8f0",

    // Hex grid
    hexStroke: isDark ? "rgba(6,182,212,0.06)" : "rgba(2,132,199,0.04)",
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatUptime(startedAt: number): string {
  const seconds = Math.floor((Date.now() - startedAt) / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

function formatMemory(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── CSS Animations ──────────────────────────────────────────────────────────

const CSS_KEYFRAMES = `
@keyframes ncv-pulse-running {
  0%, 100% { box-shadow: 0 0 8px rgba(34,197,94,0.3), 0 0 2px rgba(34,197,94,0.15); }
  50% { box-shadow: 0 0 18px rgba(34,197,94,0.5), 0 0 6px rgba(34,197,94,0.3); }
}
@keyframes ncv-breathe-starting {
  0%, 100% { box-shadow: 0 0 6px rgba(234,179,8,0.25); transform: scale(1); }
  50% { box-shadow: 0 0 16px rgba(234,179,8,0.45); transform: scale(1.015); }
}
@keyframes ncv-flash-error {
  0%, 100% { box-shadow: 0 0 6px rgba(239,68,68,0.3); }
  50% { box-shadow: 0 0 20px rgba(239,68,68,0.6), 0 0 40px rgba(239,68,68,0.2); }
}
@keyframes ncv-shake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-2px); }
  40% { transform: translateX(2px); }
  60% { transform: translateX(-1px); }
  80% { transform: translateX(1px); }
}
@keyframes ncv-expand {
  from { opacity: 0; transform: scaleY(0.95); }
  to { opacity: 1; transform: scaleY(1); }
}
@keyframes ncv-dot-appear {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes ncv-spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
`;

// ── Hex Grid Background ─────────────────────────────────────────────────────

function HexGridBg({ stroke }: { stroke: string }) {
  return (
    <svg
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
      }}
    >
      <defs>
        <pattern id="ncv-hex" width="56" height="100" patternUnits="userSpaceOnUse" patternTransform="scale(1.2)">
          <path
            d="M28 2L54 18V50L28 66L2 50V18Z M28 34L54 50V82L28 98L2 82V50Z"
            fill="none"
            stroke={stroke}
            strokeWidth="0.5"
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#ncv-hex)" />
    </svg>
  );
}

// ── Process Pill ────────────────────────────────────────────────────────────

const processStatusColors: Record<string, string> = {
  running: "#22c55e",
  runnable: "#0ea5e9",
  waiting: "#3b82f6",
  suspended: "#eab308",
  exiting: "#ef4444",
  garbing: "#a855f7",
};

function ProcessPill({
  proc,
  index,
  colors,
}: {
  proc: ProcessInfo;
  index: number;
  colors: ReturnType<typeof getThemeColors>;
}) {
  const isHighQueue = proc.messageQueueLen > 100;
  const statusColor = processStatusColors[proc.status] || colors.textMuted;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 10px",
        background: isHighQueue ? colors.queueWarning : colors.pillBg,
        border: `1px solid ${isHighQueue ? colors.queueWarningBorder : colors.pillBorder}`,
        borderLeft: `3px solid ${statusColor}`,
        borderRadius: 6,
        fontSize: 12,
        animation: isHighQueue
          ? "ncv-shake 0.4s ease-in-out infinite"
          : `ncv-dot-appear 0.3s ease-out ${index * 0.04}s both`,
        ...(isHighQueue ? { boxShadow: "0 0 8px rgba(239,68,68,0.2)" } : {}),
      }}
    >
      <span
        style={{
          fontFamily: "monospace",
          fontWeight: 600,
          color: colors.text,
          flex: 1,
          minWidth: 0,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {proc.name}
      </span>
      <span style={{ color: colors.textMuted, whiteSpace: "nowrap" }}>
        {formatMemory(proc.memory)}
      </span>
      <span
        style={{
          padding: "1px 6px",
          borderRadius: 8,
          fontSize: 10,
          fontWeight: 700,
          fontFamily: "monospace",
          background: isHighQueue ? "rgba(239,68,68,0.2)" : "rgba(100,116,139,0.15)",
          color: isHighQueue ? "#ef4444" : colors.textSecondary,
        }}
      >
        Q:{proc.messageQueueLen}
      </span>
    </div>
  );
}

// ── Process Cloud (expanded panel) ──────────────────────────────────────────

function ProcessCloud({
  processes,
  loading,
  onRefresh,
  colors,
}: {
  processes: ProcessInfo[] | null;
  loading: boolean;
  onRefresh: () => void;
  colors: ReturnType<typeof getThemeColors>;
}) {
  if (loading && !processes) {
    return (
      <div
        style={{
          padding: 20,
          textAlign: "center",
          animation: "ncv-expand 0.25s ease-out",
        }}
      >
        <div
          style={{
            width: 20,
            height: 20,
            border: `2px solid ${colors.border}`,
            borderTop: `2px solid ${colors.accent1}`,
            borderRadius: "50%",
            margin: "0 auto 8px",
            animation: "ncv-spin 0.8s linear infinite",
          }}
        />
        <span style={{ fontSize: 12, color: colors.textMuted }}>Fetching processes...</span>
      </div>
    );
  }

  if (!processes) return null;

  const sorted = [...processes].sort((a, b) => {
    const aActive = a.status === "running" || a.status === "runnable" ? 0 : 1;
    const bActive = b.status === "running" || b.status === "runnable" ? 0 : 1;
    if (aActive !== bActive) return aActive - bActive;
    return b.messageQueueLen - a.messageQueueLen;
  });

  return (
    <div style={{ animation: "ncv-expand 0.25s ease-out", transformOrigin: "top" }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "8px 0 6px",
          borderTop: `1px solid ${colors.border}`,
          marginTop: 8,
        }}
      >
        <span style={{ fontSize: 11, color: colors.textMuted, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.5px" }}>
          {sorted.length} process{sorted.length !== 1 ? "es" : ""}
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRefresh();
          }}
          style={{
            background: "none",
            border: `1px solid ${colors.border}`,
            borderRadius: 4,
            cursor: "pointer",
            padding: "2px 6px",
            fontSize: 11,
            color: loading ? colors.accent1 : colors.textMuted,
            transition: "color 0.15s",
          }}
        >
          {loading ? "\u21BB..." : "\u21BB"}
        </button>
      </div>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          maxHeight: 400,
          overflowY: "auto",
          paddingRight: 2,
        }}
      >
        {sorted.map((proc, i) => (
          <ProcessPill key={proc.name} proc={proc} index={i} colors={colors} />
        ))}
        {sorted.length === 0 && (
          <div style={{ padding: 12, textAlign: "center", fontSize: 12, color: colors.textMuted }}>
            No registered processes
          </div>
        )}
      </div>
    </div>
  );
}

// ── Node Orb ────────────────────────────────────────────────────────────────

function NodeOrb({
  node,
  expanded,
  inspectData,
  inspectLoading,
  actionBusy,
  onToggleExpand,
  onRefreshInspect,
  onStop,
  onRestart,
  colors,
}: {
  node: Props["nodes"][0];
  expanded: boolean;
  inspectData: InspectResult | undefined;
  inspectLoading: boolean;
  actionBusy: "stopping" | "restarting" | undefined;
  onToggleExpand: () => void;
  onRefreshInspect: () => void;
  onStop: (e: React.MouseEvent) => void;
  onRestart: (e: React.MouseEvent) => void;
  colors: ReturnType<typeof getThemeColors>;
}) {
  const [hovered, setHovered] = useState(false);
  const isRunning = node.status === "running";
  const isStopped = node.status === "stopped";

  const animationMap: Record<string, string> = {
    running: "ncv-pulse-running 2s ease-in-out infinite",
    starting: "ncv-breathe-starting 3s ease-in-out infinite",
    error: "ncv-flash-error 1s ease-in-out infinite",
  };

  const statusDotColor =
    node.status === "running"
      ? colors.running
      : node.status === "starting"
        ? colors.starting
        : node.status === "error"
          ? colors.error
          : colors.stopped;

  return (
    <div
      onClick={() => {
        if (isRunning && !actionBusy) onToggleExpand();
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative",
        width: expanded ? "100%" : 140,
        maxWidth: expanded ? 600 : 140,
        minHeight: expanded ? "auto" : 150,
        padding: 14,
        borderRadius: 12,
        background: expanded ? colors.surfaceExpanded : colors.surface,
        border: `1px solid ${hovered || expanded ? colors.accent1 + "40" : colors.border}`,
        cursor: isRunning && !actionBusy ? "pointer" : "default",
        opacity: isStopped ? 0.5 : actionBusy ? 0.7 : 1,
        animation: !expanded && !isStopped ? animationMap[node.status] || "none" : "none",
        transition: "width 0.3s ease, max-width 0.3s ease, opacity 0.2s, border-color 0.2s, background 0.2s",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        flexShrink: 0,
      }}
    >
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 6 }}>
        {/* Status dot */}
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: statusDotColor,
            display: "inline-block",
            flexShrink: 0,
          }}
        />
        {/* Name */}
        <span
          style={{
            fontFamily: "monospace",
            fontWeight: 700,
            fontSize: 13,
            color: colors.text,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flex: 1,
          }}
        >
          {node.name}
        </span>
        {/* Close button when expanded */}
        {expanded && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleExpand();
            }}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              fontSize: 14,
              color: colors.textMuted,
              padding: "0 2px",
              lineHeight: 1,
            }}
            aria-label="Collapse"
          >
            \u2715
          </button>
        )}
      </div>

      {/* Type badge */}
      <span
        style={{
          alignSelf: "flex-start",
          fontSize: 10,
          padding: "1px 7px",
          borderRadius: 10,
          background: node.type === "elixir" ? colors.elixirBg : colors.erlangBg,
          color: node.type === "elixir" ? colors.elixir : colors.erlang,
          fontWeight: 600,
          marginBottom: 6,
        }}
      >
        {node.type}
      </span>

      {/* Status + uptime */}
      <div style={{ fontSize: 11, color: colors.textSecondary, marginBottom: 2 }}>
        {node.status}
      </div>
      <div style={{ fontSize: 11, color: colors.textMuted }}>
        {formatUptime(node.startedAt)}
        {node.processCount != null && ` \u00B7 ${node.processCount} procs`}
      </div>

      {/* Action buttons — visible on hover or when busy */}
      {(hovered || actionBusy) && !expanded && (
        <div
          style={{
            display: "flex",
            gap: 4,
            marginTop: 8,
            animation: "ncv-dot-appear 0.15s ease-out",
          }}
        >
          <button
            onClick={onRestart}
            disabled={!!actionBusy}
            title="Restart node"
            aria-label="Restart node"
            style={{
              flex: 1,
              background: "none",
              border: `1px solid ${colors.border}`,
              borderRadius: 4,
              cursor: actionBusy ? "default" : "pointer",
              padding: "3px 0",
              fontSize: 12,
              color: actionBusy === "restarting" ? colors.starting : colors.textSecondary,
              transition: "color 0.15s",
            }}
          >
            {actionBusy === "restarting" ? "\u23F3" : "\u21BB"}
          </button>
          <button
            onClick={onStop}
            disabled={!!actionBusy}
            title="Stop node"
            aria-label="Stop node"
            style={{
              flex: 1,
              background: "none",
              border: `1px solid ${colors.border}`,
              borderRadius: 4,
              cursor: actionBusy ? "default" : "pointer",
              padding: "3px 0",
              fontSize: 12,
              color: actionBusy === "stopping" ? colors.starting : colors.error,
              transition: "color 0.15s",
            }}
          >
            {actionBusy === "stopping" ? "\u23F3" : "\u2715"}
          </button>
        </div>
      )}

      {/* Action state indicator when not hovered */}
      {actionBusy && !hovered && (
        <div style={{ marginTop: 6, fontSize: 11, color: colors.starting }}>
          {actionBusy === "stopping" ? "Stopping..." : "Restarting..."}
        </div>
      )}

      {/* Expanded: inline process list */}
      {expanded && (
        <ProcessCloud
          processes={inspectData?.processes ?? null}
          loading={inspectLoading}
          onRefresh={onRefreshInspect}
          colors={colors}
        />
      )}
    </div>
  );
}

// ── Stats Bar ───────────────────────────────────────────────────────────────

function StatsBar({
  nodes,
  onRefresh,
  refreshing,
  colors,
}: {
  nodes: Props["nodes"];
  onRefresh: () => void;
  refreshing: boolean;
  colors: ReturnType<typeof getThemeColors>;
}) {
  const running = nodes.filter((n) => n.status === "running").length;
  const errored = nodes.filter((n) => n.status === "error").length;
  const totalProcs = nodes.reduce((s, n) => s + (n.processCount ?? 0), 0);

  const healthColor = errored > 0 ? colors.error : running === nodes.length ? colors.running : colors.starting;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "10px 14px",
        background: colors.statsBg,
        border: `1px solid ${colors.statsBorder}`,
        borderRadius: 8,
        marginBottom: 12,
        fontSize: 12,
        flexWrap: "wrap",
      }}
    >
      {/* Node count */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ color: colors.textMuted }}>Nodes</span>
        <span style={{ fontWeight: 700, fontFamily: "monospace", color: colors.text }}>{nodes.length}</span>
      </div>

      {/* Process count */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ color: colors.textMuted }}>Processes</span>
        <span style={{ fontWeight: 700, fontFamily: "monospace", color: colors.text }}>{totalProcs}</span>
      </div>

      {/* Health indicator */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: healthColor,
            display: "inline-block",
            boxShadow: `0 0 6px ${healthColor}80`,
          }}
        />
        <span style={{ color: colors.textMuted }}>
          {errored > 0 ? `${errored} error` : running === nodes.length ? "All healthy" : "Partial"}
        </span>
      </div>

      {/* Spacer */}
      <div style={{ flex: 1 }} />

      {/* Refresh */}
      <button
        onClick={onRefresh}
        disabled={refreshing}
        style={{
          background: "none",
          border: `1px solid ${colors.border}`,
          borderRadius: 4,
          cursor: refreshing ? "default" : "pointer",
          padding: "3px 10px",
          fontSize: 12,
          color: refreshing ? colors.accent1 : colors.textSecondary,
          transition: "color 0.15s",
        }}
      >
        {refreshing ? "\u21BB ..." : "\u21BB Refresh"}
      </button>
    </div>
  );
}

// ── Main Component ──────────────────────────────────────────────────────────

export default function NodeClusterViz() {
  const { props, isPending } = useWidget<Props>();
  const theme = useWidgetTheme();
  const colors = getThemeColors(theme);

  const { callToolAsync: inspectNodeAsync } = useCallTool("inspect-node");
  const { callToolAsync: stopNode } = useCallTool("stop-node");
  const { callToolAsync: restartNode } = useCallTool("restart-node" as any);
  const { callToolAsync: listNodes, isPending: isRefreshing } = useCallTool("list-nodes");

  const [expandedNode, setExpandedNode] = useState<string | null>(null);
  const [inspectData, setInspectData] = useState<Record<string, InspectResult>>({});
  const [inspectLoading, setInspectLoading] = useState<Record<string, boolean>>({});
  const [actionState, setActionState] = useState<Record<string, "stopping" | "restarting">>({});

  if (isPending) {
    return (
      <McpUseProvider autoSize>
        <style>{CSS_KEYFRAMES}</style>
        <div
          style={{
            padding: 40,
            textAlign: "center",
            background: colors.bg,
            color: colors.textMuted,
          }}
        >
          <div
            style={{
              width: 24,
              height: 24,
              border: `2px solid ${colors.border}`,
              borderTop: `2px solid ${colors.accent1}`,
              borderRadius: "50%",
              margin: "0 auto 12px",
              animation: "ncv-spin 0.8s linear infinite",
            }}
          />
          Loading cluster...
        </div>
      </McpUseProvider>
    );
  }

  if (props.nodes.length === 0) {
    return (
      <McpUseProvider autoSize>
        <style>{CSS_KEYFRAMES}</style>
        <div
          style={{
            padding: 40,
            textAlign: "center",
            background: colors.bg,
            color: colors.textMuted,
            borderRadius: 8,
          }}
        >
          <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.5 }}>&#x2B22;</div>
          <div style={{ fontSize: 14, marginBottom: 4, color: colors.textSecondary }}>No managed nodes</div>
          <div style={{ fontSize: 12 }}>
            Use <code style={{ background: colors.pillBg, padding: "2px 6px", borderRadius: 4, fontFamily: "monospace" }}>start-node</code> to launch one.
          </div>
        </div>
      </McpUseProvider>
    );
  }

  // ── Handlers ────────────────────────────────────────────────────────────

  const fetchInspect = async (name: string) => {
    setInspectLoading((prev) => ({ ...prev, [name]: true }));
    try {
      const result = await inspectNodeAsync({ name });
      const sc = (result as any)?.structuredContent;
      if (sc?.processes) {
        setInspectData((prev) => ({ ...prev, [name]: { processes: sc.processes } }));
      }
    } catch {
      // inspect failed — leave existing data or empty
    } finally {
      setInspectLoading((prev) => ({ ...prev, [name]: false }));
    }
  };

  const handleToggleExpand = (name: string) => {
    if (expandedNode === name) {
      setExpandedNode(null);
    } else {
      setExpandedNode(name);
      if (!inspectData[name]) {
        fetchInspect(name);
      }
    }
  };

  const handleStop = async (name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setActionState((prev) => ({ ...prev, [name]: "stopping" }));
    try {
      await stopNode({ name });
      if (expandedNode === name) setExpandedNode(null);
      await listNodes({} as Record<string, never>);
    } catch {
      // failed
    } finally {
      setActionState((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }
  };

  const handleRestart = async (name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setActionState((prev) => ({ ...prev, [name]: "restarting" }));
    try {
      await restartNode({ name });
      if (expandedNode === name) setExpandedNode(null);
      await listNodes({} as Record<string, never>);
    } catch {
      // failed
    } finally {
      setActionState((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }
  };

  const handleRefresh = () => {
    listNodes({} as Record<string, never>);
  };

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <McpUseProvider autoSize>
      <style>{CSS_KEYFRAMES}</style>
      <div
        style={{
          padding: 16,
          background: colors.bg,
          fontFamily: "system-ui, -apple-system, sans-serif",
          color: colors.text,
          borderRadius: 8,
        }}
      >
        <StatsBar nodes={props.nodes} onRefresh={handleRefresh} refreshing={isRefreshing} colors={colors} />

        {/* Cluster field */}
        <div
          style={{
            position: "relative",
            display: "flex",
            flexWrap: "wrap",
            gap: 12,
            padding: 16,
            minHeight: 180,
            borderRadius: 8,
            border: `1px solid ${colors.border}`,
            background: colors.bg,
            overflow: "hidden",
            alignItems: "flex-start",
            alignContent: "flex-start",
          }}
        >
          <HexGridBg stroke={colors.hexStroke} />

          {props.nodes.map((node) => (
            <NodeOrb
              key={node.name}
              node={node}
              expanded={expandedNode === node.name}
              inspectData={inspectData[node.name]}
              inspectLoading={!!inspectLoading[node.name]}
              actionBusy={actionState[node.name]}
              onToggleExpand={() => handleToggleExpand(node.name)}
              onRefreshInspect={() => fetchInspect(node.name)}
              onStop={(e) => handleStop(node.name, e)}
              onRestart={(e) => handleRestart(node.name, e)}
              colors={colors}
            />
          ))}
        </div>
      </div>
    </McpUseProvider>
  );
}
