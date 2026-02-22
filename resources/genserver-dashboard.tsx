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
      genservers: z.array(
        z.object({
          name: z.string(),
          status: z.string(),
          messageQueueLen: z.number(),
          memory: z.number(),
          currentFunction: z.string(),
          tracked: z.boolean(),
          module: z.string().nullable(),
          args: z.string().nullable(),
          startedAt: z.number().nullable(),
        })
      ),
    })
  ),
});

export const widgetMetadata: WidgetMetadata = {
  description: "Cross-cluster GenServer dashboard showing all GenServers grouped by node",
  props: propsSchema,
  exposeAsTool: false,
};

type Props = z.infer<typeof propsSchema>;

// ── Theme Colors ────────────────────────────────────────────────────────────

function getThemeColors(theme: "light" | "dark") {
  const isDark = theme === "dark";
  return {
    bg: isDark ? "#0a0e17" : "#f8fafc",
    surface: isDark ? "#111827" : "#ffffff",
    surfaceHover: isDark ? "#1a2332" : "#f1f5f9",
    border: isDark ? "#1e293b" : "#e2e8f0",
    text: isDark ? "#e2e8f0" : "#1e293b",
    textSecondary: isDark ? "#94a3b8" : "#64748b",
    textMuted: isDark ? "#64748b" : "#94a3b8",

    running: "#22c55e",
    starting: "#eab308",
    error: "#ef4444",
    stopped: isDark ? "#475569" : "#94a3b8",

    erlang: isDark ? "#f59e0b" : "#b45309",
    erlangBg: isDark ? "rgba(245,158,11,0.12)" : "#fef3c7",
    elixir: isDark ? "#a78bfa" : "#7c3aed",
    elixirBg: isDark ? "rgba(167,139,250,0.12)" : "#ede9fe",

    accent1: isDark ? "#06b6d4" : "#0284c7",
    accent2: isDark ? "#a855f7" : "#7c3aed",

    managed: isDark ? "#06b6d4" : "#0891b2",
    managedBg: isDark ? "rgba(6,182,212,0.12)" : "#ecfeff",
    genserverAccent: isDark ? "#a855f7" : "#7c3aed",

    pillBg: isDark ? "#1e293b" : "#f1f5f9",
    pillBorder: isDark ? "#334155" : "#e2e8f0",
    queueWarning: isDark ? "rgba(239,68,68,0.15)" : "rgba(239,68,68,0.08)",
    queueWarningBorder: isDark ? "rgba(239,68,68,0.4)" : "rgba(239,68,68,0.3)",

    statsBg: isDark ? "#111827" : "#ffffff",
    statsBorder: isDark ? "#1e293b" : "#e2e8f0",
  };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatMemory(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── CSS Animations ──────────────────────────────────────────────────────────

const CSS_KEYFRAMES = `
@keyframes gs-shake {
  0%, 100% { transform: translateX(0); }
  20% { transform: translateX(-2px); }
  40% { transform: translateX(2px); }
  60% { transform: translateX(-1px); }
  80% { transform: translateX(1px); }
}
@keyframes gs-appear {
  from { opacity: 0; transform: translateY(6px); }
  to { opacity: 1; transform: translateY(0); }
}
@keyframes gs-spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
`;

// ── GenServer Card ──────────────────────────────────────────────────────────

function GenServerCard({
  gs,
  nodeName,
  index,
  colors,
}: {
  gs: Props["nodes"][0]["genservers"][0];
  nodeName: string;
  index: number;
  colors: ReturnType<typeof getThemeColors>;
}) {
  const [hovered, setHovered] = useState(false);
  const { callToolAsync: callGenServer, isPending: isCalling } = useCallTool("call-genserver" as any);
  const { callToolAsync: stopGenServer, isPending: isStopping } = useCallTool("stop-genserver" as any);
  const { callToolAsync: refreshDashboard } = useCallTool("show-genservers" as any);

  const isHighQueue = gs.messageQueueLen > 100;
  const busy = isCalling || isStopping;

  const handleCall = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const msg = window.prompt(`Erlang term to send to '${gs.name}' (e.g. get, {add, 5}):`);
    if (!msg) return;
    try {
      await callGenServer({ name: nodeName, server: gs.name, message: msg });
    } catch {
      // handled by hook
    }
  };

  const handleStop = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await stopGenServer({ name: nodeName, server: gs.name });
      await refreshDashboard({} as Record<string, never>);
    } catch {
      // handled by hook
    }
  };

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: "relative",
        padding: 12,
        borderRadius: 8,
        background: colors.surface,
        border: `1px solid ${hovered ? colors.genserverAccent + "50" : colors.border}`,
        borderLeft: `3px solid ${colors.genserverAccent}`,
        animation: isHighQueue
          ? "gs-shake 0.4s ease-in-out infinite"
          : `gs-appear 0.3s ease-out ${index * 0.05}s both`,
        transition: "border-color 0.15s",
        ...(isHighQueue ? { boxShadow: "0 0 10px rgba(239,68,68,0.25)" } : {}),
        display: "flex",
        flexDirection: "column" as const,
        gap: 6,
        minWidth: 0,
      }}
    >
      {/* Name row */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
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
          {gs.name}
        </span>
        {gs.tracked && (
          <span
            style={{
              fontSize: 9,
              padding: "1px 6px",
              borderRadius: 8,
              background: colors.managedBg,
              color: colors.managed,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              flexShrink: 0,
            }}
          >
            managed
          </span>
        )}
      </div>

      {/* Module (if tracked) */}
      {gs.module && (
        <span
          style={{
            fontSize: 11,
            color: colors.genserverAccent,
            fontFamily: "monospace",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {gs.module}
        </span>
      )}

      {/* Stats row */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
        <span style={{ color: colors.textMuted }}>{formatMemory(gs.memory)}</span>
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
          Q:{gs.messageQueueLen}
        </span>
      </div>

      {/* Action buttons on hover */}
      {hovered && !busy && (
        <div
          style={{
            display: "flex",
            gap: 4,
            marginTop: 2,
            animation: "gs-appear 0.1s ease-out",
          }}
        >
          <button
            onClick={handleCall}
            style={{
              flex: 1,
              background: "none",
              border: `1px solid ${colors.border}`,
              borderRadius: 4,
              cursor: "pointer",
              padding: "3px 0",
              fontSize: 11,
              color: colors.accent1,
              transition: "color 0.15s",
            }}
          >
            Call
          </button>
          <button
            onClick={handleStop}
            style={{
              flex: 1,
              background: "none",
              border: `1px solid ${colors.border}`,
              borderRadius: 4,
              cursor: "pointer",
              padding: "3px 0",
              fontSize: 11,
              color: colors.error,
              transition: "color 0.15s",
            }}
          >
            Stop
          </button>
        </div>
      )}

      {busy && (
        <div style={{ fontSize: 11, color: colors.starting, marginTop: 2 }}>
          {isCalling ? "Calling..." : "Stopping..."}
        </div>
      )}
    </div>
  );
}

// ── Node Section ────────────────────────────────────────────────────────────

function NodeSection({
  node,
  colors,
}: {
  node: Props["nodes"][0];
  colors: ReturnType<typeof getThemeColors>;
}) {
  const isOnline = node.status === "running";
  const statusDotColor = isOnline ? colors.running : node.status === "starting" ? colors.starting : node.status === "error" ? colors.error : colors.stopped;

  return (
    <div style={{ marginBottom: 16 }}>
      {/* Node header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 8,
          padding: "6px 0",
        }}
      >
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: statusDotColor,
            display: "inline-block",
            flexShrink: 0,
            boxShadow: `0 0 6px ${statusDotColor}80`,
          }}
        />
        <span
          style={{
            fontFamily: "monospace",
            fontWeight: 700,
            fontSize: 14,
            color: colors.text,
          }}
        >
          {node.name}
        </span>
        <span
          style={{
            fontSize: 10,
            padding: "1px 7px",
            borderRadius: 10,
            background: node.type === "elixir" ? colors.elixirBg : colors.erlangBg,
            color: node.type === "elixir" ? colors.elixir : colors.erlang,
            fontWeight: 600,
          }}
        >
          {node.type}
        </span>
        <span style={{ fontSize: 11, color: colors.textMuted }}>
          {isOnline ? `${node.genservers.length} GenServer${node.genservers.length !== 1 ? "s" : ""}` : node.status}
        </span>
      </div>

      {/* GenServer cards or offline message */}
      {!isOnline ? (
        <div
          style={{
            padding: 12,
            fontSize: 12,
            color: colors.textMuted,
            fontStyle: "italic",
          }}
        >
          Node is {node.status}
        </div>
      ) : node.genservers.length === 0 ? (
        <div
          style={{
            padding: 12,
            fontSize: 12,
            color: colors.textMuted,
          }}
        >
          No GenServers running
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
            gap: 8,
          }}
        >
          {node.genservers.map((gs, i) => (
            <GenServerCard
              key={gs.name}
              gs={gs}
              nodeName={node.name}
              index={i}
              colors={colors}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Summary Bar ─────────────────────────────────────────────────────────────

function SummaryBar({
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
  const totalGs = nodes.reduce((s, n) => s + n.genservers.length, 0);
  const managedGs = nodes.reduce((s, n) => s + n.genservers.filter((g) => g.tracked).length, 0);
  const onlineNodes = nodes.filter((n) => n.status === "running").length;
  const highQueueCount = nodes.reduce((s, n) => s + n.genservers.filter((g) => g.messageQueueLen > 100).length, 0);

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
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ color: colors.textMuted }}>GenServers</span>
        <span style={{ fontWeight: 700, fontFamily: "monospace", color: colors.text }}>{totalGs}</span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ color: colors.textMuted }}>Managed</span>
        <span style={{ fontWeight: 700, fontFamily: "monospace", color: colors.managed }}>{managedGs}</span>
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ color: colors.textMuted }}>Nodes Online</span>
        <span style={{ fontWeight: 700, fontFamily: "monospace", color: colors.text }}>
          {onlineNodes}/{nodes.length}
        </span>
      </div>

      {highQueueCount > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: colors.error,
              display: "inline-block",
              boxShadow: `0 0 6px ${colors.error}80`,
            }}
          />
          <span style={{ color: colors.error, fontWeight: 600 }}>
            {highQueueCount} high queue
          </span>
        </div>
      )}

      <div style={{ flex: 1 }} />

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

export default function GenServerDashboard() {
  const { props, isPending } = useWidget<Props>();
  const theme = useWidgetTheme();
  const colors = getThemeColors(theme);
  const { callToolAsync: showGenServers, isPending: isRefreshing } = useCallTool("show-genservers" as any);

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
              borderTop: `2px solid ${colors.genserverAccent}`,
              borderRadius: "50%",
              margin: "0 auto 12px",
              animation: "gs-spin 0.8s linear infinite",
            }}
          />
          Loading GenServers...
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
          <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.5 }}>&#x2699;</div>
          <div style={{ fontSize: 14, marginBottom: 4, color: colors.textSecondary }}>No managed nodes</div>
          <div style={{ fontSize: 12 }}>
            Use{" "}
            <code
              style={{
                background: colors.pillBg,
                padding: "2px 6px",
                borderRadius: 4,
                fontFamily: "monospace",
              }}
            >
              start-node
            </code>{" "}
            to launch one, then{" "}
            <code
              style={{
                background: colors.pillBg,
                padding: "2px 6px",
                borderRadius: 4,
                fontFamily: "monospace",
              }}
            >
              start-genserver
            </code>{" "}
            to add GenServers.
          </div>
        </div>
      </McpUseProvider>
    );
  }

  const handleRefresh = () => {
    showGenServers({} as Record<string, never>);
  };

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
        <SummaryBar
          nodes={props.nodes}
          onRefresh={handleRefresh}
          refreshing={isRefreshing}
          colors={colors}
        />

        {props.nodes.map((node) => (
          <NodeSection key={node.name} node={node} colors={colors} />
        ))}
      </div>
    </McpUseProvider>
  );
}
