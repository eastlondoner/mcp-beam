import { useState, useEffect, useRef, useCallback } from "react";
import { McpUseProvider, useWidget, useCallTool, type WidgetMetadata } from "mcp-use/react";
import { z } from "zod";

const propsSchema = z.object({
  nodeName: z.string(),
  graphNodes: z.array(z.object({
    name: z.string(),
    status: z.string(),
    messageQueueLen: z.number(),
    memory: z.number(),
    currentFunction: z.string(),
    type: z.enum(["genserver", "supervisor", "genstatem", "system"]),
  })),
  edges: z.array(z.object({
    from: z.string(),
    to: z.string(),
    type: z.enum(["link", "monitor"]),
  })),
  traceActive: z.boolean(),
  traceEdges: z.array(z.object({
    from: z.string(),
    to: z.string(),
    count: z.number(),
  })),
});

export const widgetMetadata: WidgetMetadata = {
  description: "Process topology graph showing links, monitors, and live message traces between registered processes",
  props: propsSchema,
  exposeAsTool: false,
};

type Props = z.infer<typeof propsSchema>;

const NODE_COLORS: Record<string, string> = {
  genserver: "#22c55e",
  supervisor: "#3b82f6",
  genstatem: "#8b5cf6",
  system: "#6b7280",
};

const CANVAS_W = 600;
const CANVAS_H = 500;
const NODE_RADIUS = 10;

function formatMemory(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

interface NodePos {
  x: number;
  y: number;
  name: string;
}

function computeLayout(names: string[]): NodePos[] {
  const n = names.length;
  if (n === 0) return [];
  const cx = CANVAS_W / 2;
  const cy = CANVAS_H / 2;
  const r = Math.min(Math.max(n * 14, 80), 200);
  return names.map((name, i) => {
    const angle = (2 * Math.PI * i) / n - Math.PI / 2;
    return { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle), name };
  });
}

export default function ProcessTopology() {
  const { props, isPending } = useWidget<Props>();
  const { callToolAsync: startTrace } = useCallTool("start-trace");
  const { callToolAsync: stopTrace } = useCallTool("stop-trace");
  const { callToolAsync: pollTrace } = useCallTool("poll-trace");

  const [tracing, setTracing] = useState(false);
  const [traceEdges, setTraceEdges] = useState<Props["traceEdges"]>([]);
  const [localNodes, setLocalNodes] = useState<Props["graphNodes"]>([]);
  const [localEdges, setLocalEdges] = useState<Props["edges"]>([]);
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);
  const [toggling, setToggling] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const animRef = useRef<number>(0);
  const dashOffset = useRef(0);
  const positionsRef = useRef<NodePos[]>([]);

  // Sync from props on load
  useEffect(() => {
    if (isPending) return;
    setLocalNodes(props.graphNodes);
    setLocalEdges(props.edges);
    if (props.traceActive) {
      setTracing(true);
      setTraceEdges(props.traceEdges);
    }
  }, [isPending]);

  // Compute layout
  useEffect(() => {
    positionsRef.current = computeLayout(localNodes.map((n) => n.name));
  }, [localNodes]);

  // Polling
  useEffect(() => {
    if (!tracing || isPending) return;
    const pollNodeName = props.nodeName;

    const doPoll = async () => {
      try {
        const result = await pollTrace({ name: pollNodeName });
        const sc = result?.structuredContent as Props | undefined;
        if (sc) {
          setLocalNodes(sc.graphNodes);
          setLocalEdges(sc.edges);
          setTraceEdges((prev) => {
            // Merge: accumulate counts from this poll into existing edges for display
            const merged = new Map<string, number>();
            for (const e of prev) merged.set(`${e.from}|${e.to}`, e.count);
            for (const e of sc.traceEdges) {
              const key = `${e.from}|${e.to}`;
              merged.set(key, (merged.get(key) || 0) + e.count);
            }
            return Array.from(merged.entries()).map(([key, count]) => {
              const [from, to] = key.split("|");
              return { from, to, count };
            });
          });
          if (!sc.traceActive) {
            setTracing(false);
          }
        }
      } catch {
        // poll failed, don't crash — will retry
      }
    };

    doPoll();
    pollRef.current = setInterval(doPoll, 3000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [tracing, isPending]);

  // Canvas drawing
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = CANVAS_W * dpr;
    canvas.height = CANVAS_H * dpr;
    ctx.scale(dpr, dpr);

    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

    const positions = positionsRef.current;
    const posMap = new Map<string, NodePos>();
    for (const p of positions) posMap.set(p.name, p);

    // Draw link edges (gray solid)
    ctx.save();
    for (const edge of localEdges) {
      const from = posMap.get(edge.from);
      const to = posMap.get(edge.to);
      if (!from || !to) continue;

      const isHovered = hoveredNode === edge.from || hoveredNode === edge.to;
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.strokeStyle = isHovered ? "#9ca3af" : "#d1d5db";
      ctx.lineWidth = isHovered ? 1.5 : 1;
      if (edge.type === "monitor") {
        ctx.setLineDash([4, 4]);
      } else {
        ctx.setLineDash([]);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // Arrowhead for monitors
      if (edge.type === "monitor") {
        const dx = to.x - from.x;
        const dy = to.y - from.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        if (len > 0) {
          const ux = dx / len;
          const uy = dy / len;
          const tipX = to.x - ux * NODE_RADIUS;
          const tipY = to.y - uy * NODE_RADIUS;
          const arrowLen = 8;
          ctx.beginPath();
          ctx.moveTo(tipX, tipY);
          ctx.lineTo(tipX - arrowLen * ux + 4 * uy, tipY - arrowLen * uy - 4 * ux);
          ctx.lineTo(tipX - arrowLen * ux - 4 * uy, tipY - arrowLen * uy + 4 * ux);
          ctx.closePath();
          ctx.fillStyle = isHovered ? "#9ca3af" : "#d1d5db";
          ctx.fill();
        }
      }
    }
    ctx.restore();

    // Draw trace edges (orange animated)
    if (tracing && traceEdges.length > 0) {
      ctx.save();
      for (const te of traceEdges) {
        const from = posMap.get(te.from);
        const to = posMap.get(te.to);
        if (!from || !to) continue;

        const thickness = Math.min(1 + Math.log2(te.count + 1), 8);
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.strokeStyle = "rgba(245, 158, 11, 0.6)";
        ctx.lineWidth = thickness;
        ctx.setLineDash([8, 6]);
        ctx.lineDashOffset = -dashOffset.current;
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.restore();
    }

    // Draw nodes
    const nodeMap = new Map<string, Props["graphNodes"][number]>();
    for (const n of localNodes) nodeMap.set(n.name, n);

    for (const pos of positions) {
      const nodeData = nodeMap.get(pos.name);
      if (!nodeData) continue;

      const isHovered = hoveredNode === pos.name;
      const color = NODE_COLORS[nodeData.type] || NODE_COLORS.system;
      const radius = isHovered ? NODE_RADIUS + 3 : NODE_RADIUS;

      ctx.beginPath();
      ctx.arc(pos.x, pos.y, radius, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
      if (isHovered) {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();
      }

      // Label
      ctx.fillStyle = "#374151";
      ctx.font = `${isHovered ? "bold " : ""}11px system-ui, -apple-system, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(
        nodeData.name.length > 16 ? nodeData.name.slice(0, 14) + ".." : nodeData.name,
        pos.x,
        pos.y + radius + 14,
      );
    }

    // Hover tooltip
    if (hoveredNode) {
      const nodeData = nodeMap.get(hoveredNode);
      const pos = posMap.get(hoveredNode);
      if (nodeData && pos) {
        const lines = [
          nodeData.name,
          `Type: ${nodeData.type}`,
          `Status: ${nodeData.status}`,
          `Memory: ${formatMemory(nodeData.memory)}`,
          `Queue: ${nodeData.messageQueueLen}`,
          `Fn: ${nodeData.currentFunction}`,
        ];
        const padding = 8;
        const lineHeight = 16;
        const tooltipW = 200;
        const tooltipH = lines.length * lineHeight + padding * 2;
        let tx = pos.x + NODE_RADIUS + 10;
        let ty = pos.y - tooltipH / 2;
        if (tx + tooltipW > CANVAS_W) tx = pos.x - NODE_RADIUS - 10 - tooltipW;
        if (ty < 0) ty = 4;
        if (ty + tooltipH > CANVAS_H) ty = CANVAS_H - tooltipH - 4;

        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.strokeStyle = "#d1d5db";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(tx, ty, tooltipW, tooltipH, 6);
        ctx.fill();
        ctx.stroke();

        ctx.fillStyle = "#374151";
        ctx.font = "bold 11px system-ui, -apple-system, sans-serif";
        ctx.textAlign = "left";
        ctx.fillText(lines[0], tx + padding, ty + padding + 12);
        ctx.font = "11px system-ui, -apple-system, sans-serif";
        for (let i = 1; i < lines.length; i++) {
          ctx.fillText(lines[i], tx + padding, ty + padding + 12 + i * lineHeight);
        }
      }
    }
  }, [localNodes, localEdges, traceEdges, hoveredNode, tracing]);

  // Animation loop (only when tracing for dash animation)
  useEffect(() => {
    let running = true;

    const tick = () => {
      if (!running) return;
      if (tracing) dashOffset.current += 0.5;
      draw();
      animRef.current = requestAnimationFrame(tick);
    };

    tick();
    return () => {
      running = false;
      cancelAnimationFrame(animRef.current);
    };
  }, [draw, tracing]);

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_W / rect.width;
    const scaleY = CANVAS_H / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;

    let found: string | null = null;
    for (const pos of positionsRef.current) {
      const dx = mx - pos.x;
      const dy = my - pos.y;
      if (dx * dx + dy * dy < (NODE_RADIUS + 5) * (NODE_RADIUS + 5)) {
        found = pos.name;
        break;
      }
    }
    setHoveredNode(found);
  };

  const nodeName = isPending ? "" : props.nodeName;

  const handleToggleTrace = async () => {
    if (!nodeName) return;
    setToggling(true);
    try {
      if (tracing) {
        await stopTrace({ name: nodeName });
        setTracing(false);
        setTraceEdges([]);
      } else {
        await startTrace({ name: nodeName });
        setTracing(true);
      }
    } catch {
      // toggle failed
    } finally {
      setToggling(false);
    }
  };

  if (isPending) {
    return (
      <McpUseProvider autoSize>
        <div style={{ padding: 20, color: "#888" }}>Building topology graph...</div>
      </McpUseProvider>
    );
  }

  return (
    <McpUseProvider autoSize>
      <div style={{ padding: 16, fontFamily: "system-ui, -apple-system, sans-serif" }}>
        <style>{`
          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.4; }
          }
        `}</style>

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
          <div>
            <span style={{ fontFamily: "monospace", fontWeight: 700, fontSize: 18 }}>
              {nodeName}
            </span>
            <span style={{ fontSize: 13, color: "#888", marginLeft: 8 }}>
              {localNodes.length} processes &middot; {localEdges.length} edges
            </span>
          </div>
          <button
            onClick={handleToggleTrace}
            disabled={toggling}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 14px",
              borderRadius: 6,
              border: "1px solid",
              borderColor: tracing ? "#ef4444" : "#d1d5db",
              background: tracing ? "#fef2f2" : "#fff",
              color: tracing ? "#dc2626" : "#374151",
              fontSize: 13,
              fontWeight: 500,
              cursor: toggling ? "wait" : "pointer",
              opacity: toggling ? 0.6 : 1,
            }}
          >
            {tracing && (
              <span style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: "#ef4444",
                animation: "pulse 1.5s ease-in-out infinite",
              }} />
            )}
            {toggling ? (tracing ? "Stopping..." : "Starting...") : tracing ? "Stop Tracing" : "Start Tracing"}
          </button>
        </div>

        {/* Canvas */}
        <canvas
          ref={canvasRef}
          width={CANVAS_W}
          height={CANVAS_H}
          onMouseMove={handleMouseMove}
          onMouseLeave={() => setHoveredNode(null)}
          style={{
            width: "100%",
            maxWidth: CANVAS_W,
            height: "auto",
            border: "1px solid #e5e7eb",
            borderRadius: 8,
            cursor: hoveredNode ? "pointer" : "default",
          }}
        />

        {/* Legend */}
        <div style={{ display: "flex", gap: 16, marginTop: 10, fontSize: 12, color: "#6b7280", flexWrap: "wrap" }}>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 20, height: 2, background: "#d1d5db", display: "inline-block" }} />
            Link
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 20, height: 0, borderTop: "2px dashed #d1d5db", display: "inline-block" }} />
            Monitor
          </span>
          {tracing && (
            <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span style={{ width: 20, height: 0, borderTop: "3px dashed #f59e0b", display: "inline-block" }} />
              Message
            </span>
          )}
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#22c55e", display: "inline-block" }} />
            GenServer
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#3b82f6", display: "inline-block" }} />
            Supervisor
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#8b5cf6", display: "inline-block" }} />
            GenStatem
          </span>
          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#6b7280", display: "inline-block" }} />
            System
          </span>
        </div>

        {localNodes.length === 0 && (
          <div style={{ padding: 40, textAlign: "center", color: "#888" }}>
            No registered processes found on this node.
          </div>
        )}
      </div>
    </McpUseProvider>
  );
}
