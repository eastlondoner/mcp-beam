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
          {props.nodes.map((node) => (
            <div
              key={node.name}
              onClick={() => {
                if (node.status === "running") {
                  inspectNode({ name: node.name });
                }
              }}
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: 8,
                padding: 16,
                cursor: node.status === "running" ? "pointer" : "default",
                transition: "box-shadow 0.15s",
                background: "#fff",
              }}
              onMouseEnter={(e) => {
                if (node.status === "running") {
                  (e.currentTarget as HTMLDivElement).style.boxShadow = "0 2px 8px rgba(0,0,0,0.1)";
                }
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
              }}
            >
              {/* Header: name + type badge */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
                <span style={{ fontFamily: "monospace", fontWeight: 600, fontSize: 14 }}>
                  {node.name}
                </span>
                <span style={{
                  fontSize: 11,
                  padding: "2px 8px",
                  borderRadius: 12,
                  background: node.type === "elixir" ? "#ede9fe" : "#fef3c7",
                  color: node.type === "elixir" ? "#7c3aed" : "#b45309",
                  fontWeight: 500,
                }}>
                  {node.type}
                </span>
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
              {node.status === "running" && (
                <div style={{ marginTop: 8, fontSize: 11, color: "#3b82f6" }}>
                  {isInspecting ? "Inspecting..." : "Click to inspect"}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </McpUseProvider>
  );
}
