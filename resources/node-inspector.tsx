import { McpUseProvider, useWidget, type WidgetMetadata } from "mcp-use/react";
import { z } from "zod";

const propsSchema = z.object({
  nodeName: z.string(),
  nodeType: z.enum(["erlang", "elixir"]),
  uptime: z.number(),
  processes: z.array(z.object({
    name: z.string(),
    status: z.string(),
    messageQueueLen: z.number(),
    memory: z.number(),
    currentFunction: z.string(),
  })),
});

export const widgetMetadata: WidgetMetadata = {
  description: "Inspector showing registered processes for a single BEAM node",
  props: propsSchema,
  exposeAsTool: false,
};

type Props = z.infer<typeof propsSchema>;

function formatUptime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
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

const statusBadgeColors: Record<string, { bg: string; text: string }> = {
  running: { bg: "#dcfce7", text: "#16a34a" },
  waiting: { bg: "#dbeafe", text: "#2563eb" },
  suspended: { bg: "#fef9c3", text: "#ca8a04" },
  exiting: { bg: "#fee2e2", text: "#dc2626" },
  garbing: { bg: "#f3e8ff", text: "#9333ea" },
  runnable: { bg: "#e0f2fe", text: "#0284c7" },
};

export default function NodeInspector() {
  const { props, isPending } = useWidget<Props>();

  if (isPending) {
    return (
      <McpUseProvider autoSize>
        <div style={{ padding: 20, color: "#888" }}>Inspecting node...</div>
      </McpUseProvider>
    );
  }

  const sorted = [...props.processes].sort((a, b) => {
    // running/runnable first
    const aRunning = a.status === "running" || a.status === "runnable" ? 0 : 1;
    const bRunning = b.status === "running" || b.status === "runnable" ? 0 : 1;
    if (aRunning !== bRunning) return aRunning - bRunning;
    // then by message queue length descending
    return b.messageQueueLen - a.messageQueueLen;
  });

  const hasHighQueue = sorted.some((p) => p.messageQueueLen > 100);

  return (
    <McpUseProvider autoSize>
      <div style={{ padding: 16, fontFamily: "system-ui, -apple-system, sans-serif" }}>
        {/* Header */}
        <div style={{ marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
            <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 18 }}>
              {props.nodeName}
            </span>
            <span style={{
              fontSize: 11,
              padding: "2px 8px",
              borderRadius: 12,
              background: props.nodeType === "elixir" ? "#ede9fe" : "#fef3c7",
              color: props.nodeType === "elixir" ? "#7c3aed" : "#b45309",
              fontWeight: 500,
            }}>
              {props.nodeType}
            </span>
          </div>
          <div style={{ fontSize: 13, color: "#888" }}>
            Uptime: {formatUptime(props.uptime)} &middot; {sorted.length} registered process{sorted.length !== 1 ? "es" : ""}
          </div>
        </div>

        {/* Warning banner */}
        {hasHighQueue && (
          <div style={{
            background: "#fef2f2",
            border: "1px solid #fecaca",
            borderRadius: 6,
            padding: "8px 12px",
            marginBottom: 12,
            fontSize: 13,
            color: "#dc2626",
          }}>
            Warning: One or more processes have a message queue length &gt; 100
          </div>
        )}

        {/* Process table */}
        <div style={{ overflowX: "auto" }}>
          <table style={{
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 13,
          }}>
            <thead>
              <tr style={{ borderBottom: "2px solid #e5e7eb" }}>
                <th style={{ textAlign: "left", padding: "8px 12px", color: "#555", fontWeight: 600 }}>Process</th>
                <th style={{ textAlign: "left", padding: "8px 12px", color: "#555", fontWeight: 600 }}>Status</th>
                <th style={{ textAlign: "right", padding: "8px 12px", color: "#555", fontWeight: 600 }}>Msg Queue</th>
                <th style={{ textAlign: "right", padding: "8px 12px", color: "#555", fontWeight: 600 }}>Memory</th>
                <th style={{ textAlign: "left", padding: "8px 12px", color: "#555", fontWeight: 600 }}>Current Function</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((proc) => {
                const colors = statusBadgeColors[proc.status] || { bg: "#f3f4f6", text: "#374151" };
                return (
                  <tr key={proc.name} style={{ borderBottom: "1px solid #f3f4f6" }}>
                    <td style={{ padding: "6px 12px", fontFamily: "monospace", fontWeight: 500 }}>
                      {proc.name}
                    </td>
                    <td style={{ padding: "6px 12px" }}>
                      <span style={{
                        fontSize: 11,
                        padding: "2px 8px",
                        borderRadius: 10,
                        background: colors.bg,
                        color: colors.text,
                        fontWeight: 500,
                      }}>
                        {proc.status}
                      </span>
                    </td>
                    <td style={{
                      padding: "6px 12px",
                      textAlign: "right",
                      fontFamily: "monospace",
                      color: proc.messageQueueLen > 100 ? "#dc2626" : proc.messageQueueLen > 10 ? "#ca8a04" : "#555",
                      fontWeight: proc.messageQueueLen > 100 ? 700 : 400,
                    }}>
                      {proc.messageQueueLen}
                    </td>
                    <td style={{
                      padding: "6px 12px",
                      textAlign: "right",
                      fontFamily: "monospace",
                      color: "#555",
                    }}>
                      {formatMemory(proc.memory)}
                    </td>
                    <td style={{
                      padding: "6px 12px",
                      fontFamily: "monospace",
                      fontSize: 12,
                      color: "#888",
                    }}>
                      {proc.currentFunction}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {sorted.length === 0 && (
          <div style={{ padding: 20, textAlign: "center", color: "#888" }}>
            No registered processes found.
          </div>
        )}
      </div>
    </McpUseProvider>
  );
}
