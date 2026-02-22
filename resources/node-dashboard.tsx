import { useState } from "react";
import { McpUseProvider, useWidget, useCallTool, type WidgetMetadata } from "mcp-use/react";
import { z } from "zod";

const propsSchema = z.object({
  nodes: z.array(z.object({
    name: z.string(),
    type: z.enum(["erlang", "elixir"]),
    status: z.string(),
    startedAt: z.number(),
    processCount: z.number().nullable(),
  })),
});

export const widgetMetadata: WidgetMetadata = {
  description: "Dashboard showing all managed BEAM nodes as cards",
  props: propsSchema,
  exposeAsTool: false,
};

type Props = z.infer<typeof propsSchema>;

function formatUptime(startedAt: number): string {
  const seconds = Math.floor((Date.now() - startedAt) / 1000);
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
}

const statusColors: Record<string, string> = {
  running: "#22c55e",
  starting: "#eab308",
  error: "#ef4444",
  stopped: "#6b7280",
};

export default function NodeDashboard() {
  const { props, isPending } = useWidget<Props>();
  const { callTool: inspectNode, isPending: isInspecting } = useCallTool("inspect-node");
  const { callToolAsync: stopNode } = useCallTool("stop-node");
  const { callToolAsync: restartNode } = useCallTool("restart-node" as any);
  const { callToolAsync: listNodes } = useCallTool("list-nodes");
  const [actionState, setActionState] = useState<Record<string, "stopping" | "restarting">>({});

  if (isPending) {
    return (
      <McpUseProvider autoSize>
        <div style={{ padding: 20, color: "#888" }}>Loading node dashboard...</div>
      </McpUseProvider>
    );
  }

  if (props.nodes.length === 0) {
    return (
      <McpUseProvider autoSize>
        <div style={{ padding: 32, textAlign: "center" }}>
          <div style={{ fontSize: 36, marginBottom: 8 }}>&#x1f4e6;</div>
          <p style={{ color: "#888", fontSize: 14 }}>
            No managed nodes yet. Use <code style={{ background: "#f3f4f6", padding: "2px 6px", borderRadius: 4 }}>start-node</code> to launch one.
          </p>
        </div>
      </McpUseProvider>
    );
  }

  const handleStop = async (name: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setActionState((prev) => ({ ...prev, [name]: "stopping" }));
    try {
      await stopNode({ name });
      await listNodes({} as Record<string, never>);
    } catch {
      // action failed, clear state
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
      await listNodes({} as Record<string, never>);
    } catch {
      // action failed, clear state
    } finally {
      setActionState((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }
  };

  return (
    <McpUseProvider autoSize>
      <div style={{ padding: 16 }}>
        <div style={{ marginBottom: 12, fontSize: 13, color: "#888" }}>
          {props.nodes.length} node{props.nodes.length !== 1 ? "s" : ""} managed
        </div>

        <div style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
          gap: 12,
        }}>
          {props.nodes.map((node) => {
            const busy = actionState[node.name];

            return (
              <div
                key={node.name}
                onClick={() => {
                  if (node.status === "running" && !busy) {
                    inspectNode({ name: node.name });
                  }
                }}
                style={{
                  border: "1px solid #e5e7eb",
                  borderRadius: 8,
                  padding: 16,
                  cursor: node.status === "running" && !busy ? "pointer" : "default",
                  transition: "box-shadow 0.15s",
                  background: "#fff",
                  opacity: busy ? 0.7 : 1,
                }}
                onMouseEnter={(e) => {
                  if (node.status === "running" && !busy) {
                    (e.currentTarget as HTMLDivElement).style.boxShadow = "0 2px 8px rgba(0,0,0,0.1)";
                  }
                }}
                onMouseLeave={(e) => {
                  (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
                }}
              >
                {/* Header: name + action buttons + type badge */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                  <span style={{ fontFamily: "monospace", fontWeight: 600, fontSize: 14 }}>
                    {node.name}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    {/* Restart button */}
                    <button
                      onClick={(e) => handleRestart(node.name, e)}
                      disabled={!!busy}
                      title="Restart node"
                      style={{
                        background: "none",
                        border: "1px solid #e5e7eb",
                        borderRadius: 4,
                        cursor: busy ? "default" : "pointer",
                        padding: "2px 6px",
                        fontSize: 13,
                        color: busy === "restarting" ? "#eab308" : "#555",
                        lineHeight: 1,
                      }}
                    >
                      {busy === "restarting" ? "\u23F3" : "\u21BB"}
                    </button>
                    {/* Stop button */}
                    <button
                      onClick={(e) => handleStop(node.name, e)}
                      disabled={!!busy}
                      title="Stop node"
                      style={{
                        background: "none",
                        border: "1px solid #e5e7eb",
                        borderRadius: 4,
                        cursor: busy ? "default" : "pointer",
                        padding: "2px 6px",
                        fontSize: 13,
                        color: busy === "stopping" ? "#eab308" : "#ef4444",
                        lineHeight: 1,
                      }}
                    >
                      {busy === "stopping" ? "\u23F3" : "\u2715"}
                    </button>
                    {/* Type badge */}
                    <span style={{
                      fontSize: 11,
                      padding: "2px 8px",
                      borderRadius: 12,
                      background: node.type === "elixir" ? "#ede9fe" : "#fef3c7",
                      color: node.type === "elixir" ? "#7c3aed" : "#b45309",
                      fontWeight: 500,
                      marginLeft: 4,
                    }}>
                      {node.type}
                    </span>
                  </div>
                </div>

                {/* Status indicator */}
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                  <span style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: statusColors[node.status] || "#6b7280",
                    display: "inline-block",
                  }} />
                  <span style={{ fontSize: 13, color: "#555" }}>{node.status}</span>
                </div>

                {/* Details */}
                <div style={{ fontSize: 12, color: "#888", display: "flex", flexDirection: "column", gap: 2 }}>
                  <span>Uptime: {formatUptime(node.startedAt)}</span>
                  {node.processCount != null && (
                    <span>Processes: {node.processCount}</span>
                  )}
                </div>

                {/* Click hint for running nodes */}
                {node.status === "running" && !busy && (
                  <div style={{ marginTop: 8, fontSize: 11, color: "#3b82f6" }}>
                    {isInspecting ? "Inspecting..." : "Click to inspect"}
                  </div>
                )}

                {/* Action in-flight indicator */}
                {busy && (
                  <div style={{ marginTop: 8, fontSize: 11, color: "#eab308" }}>
                    {busy === "stopping" ? "Stopping..." : "Restarting..."}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </McpUseProvider>
  );
}
