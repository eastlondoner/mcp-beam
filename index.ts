import { MCPServer, text, widget, error } from "mcp-use/server";
import { z } from "zod";
import { Client, type ClientChannel } from "ssh2";

// ── Server ──────────────────────────────────────────────────────────────────

const server = new MCPServer({
  name: "beam-node-manager",
  title: "BEAM Node Manager",
  version: "1.0.0",
  description: "Start, stop, and inspect Erlang/Elixir BEAM nodes",
  baseUrl: process.env.MCP_URL || "http://localhost:3000",
  favicon: "favicon.ico",
  websiteUrl: "https://mcp-use.com",
  icons: [
    {
      src: "icon.svg",
      mimeType: "image/svg+xml",
      sizes: ["512x512"],
    },
  ],
});

// ── SSH Host Configuration ──────────────────────────────────────────────────

interface SSHHostConfig {
  label: string;
  user: string;
  hostname: string;
  port: number;
  erlPath: string;
  elixirPath: string;
  remoteShortHost: string;
  connection: Client | null;
}

const sshHosts = new Map<string, SSHHostConfig>();
const SSH_PRIVATE_KEY = process.env.SSH_PRIVATE_KEY || "";

function parseSSHHosts(): void {
  const hostsEnv = process.env.SSH_HOSTS || "";
  if (!hostsEnv) return;

  for (const entry of hostsEnv.split(",")) {
    const trimmed = entry.trim();
    if (!trimmed) continue;

    // Format: name:user@host[:port][:erlPath:elixirPath]
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) continue;

    const label = trimmed.slice(0, colonIdx);
    const rest = trimmed.slice(colonIdx + 1);

    const parts = rest.split(":");
    const userHost = parts[0];

    const atIdx = userHost.indexOf("@");
    if (atIdx === -1) continue;

    const user = userHost.slice(0, atIdx);
    const hostname = userHost.slice(atIdx + 1);

    // If next part is numeric, it's a port
    let port = 22;
    let pathOffset = 1;
    if (parts[1] && /^\d+$/.test(parts[1])) {
      port = parseInt(parts[1], 10);
      pathOffset = 2;
    }

    const erlPath = parts[pathOffset] || "erl";
    const elixirPath = parts[pathOffset + 1] || "elixir";

    sshHosts.set(label, {
      label,
      user,
      hostname,
      port,
      erlPath,
      elixirPath,
      remoteShortHost: "",
      connection: null,
    });
  }
}

parseSSHHosts();

// ── SSH Connection Pool ─────────────────────────────────────────────────────

function getSSHConnection(hostLabel: string): Promise<Client> {
  const hostConfig = sshHosts.get(hostLabel);
  if (!hostConfig) {
    return Promise.reject(new Error(`SSH host "${hostLabel}" not configured`));
  }

  if (hostConfig.connection) {
    return Promise.resolve(hostConfig.connection);
  }

  return new Promise((resolve, reject) => {
    const conn = new Client();

    conn.on("ready", async () => {
      hostConfig.connection = conn;

      // Cache the remote short hostname
      if (!hostConfig.remoteShortHost) {
        try {
          const hn = await sshExecSimple(conn, "hostname -s", 5000);
          hostConfig.remoteShortHost = hn.trim();
        } catch {
          hostConfig.remoteShortHost = hostConfig.hostname.split(".")[0];
        }
      }

      resolve(conn);
    });

    conn.on("error", (err) => {
      hostConfig.connection = null;
      reject(err);
    });

    conn.on("close", () => {
      hostConfig.connection = null;
    });

    conn.connect({
      host: hostConfig.hostname,
      port: hostConfig.port,
      username: hostConfig.user,
      privateKey: SSH_PRIVATE_KEY,
    });
  });
}

// ── SSH Exec Helpers ────────────────────────────────────────────────────────

function sshExecSimple(conn: Client, command: string, timeout: number = 10_000): Promise<string> {
  return new Promise((resolve, reject) => {
    conn.exec(command, (err, stream) => {
      if (err) return reject(err);

      let stdout = "";
      let stderr = "";

      stream.on("data", (data: Buffer) => { stdout += data.toString(); });
      stream.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });

      const timer = setTimeout(() => {
        stream.close();
        reject(new Error(`SSH exec timeout (${timeout}ms): ${command.slice(0, 80)}`));
      }, timeout);

      stream.on("close", () => {
        clearTimeout(timer);
        resolve(stdout.trim());
      });
    });
  });
}

function sshExecLongRunning(conn: Client, command: string): Promise<ClientChannel> {
  return new Promise((resolve, reject) => {
    conn.exec(command, (err, stream) => {
      if (err) return reject(err);
      resolve(stream);
    });
  });
}

// ── Shell Escaping ──────────────────────────────────────────────────────────

function shellEscape(s: string): string {
  return "'" + s.replace(/'/g, "'\\''") + "'";
}

// ── State ───────────────────────────────────────────────────────────────────

interface ManagedNode {
  channel: ClientChannel;
  hostLabel: string;
  remoteShortHost: string;
  type: "erlang" | "elixir";
  startedAt: number;
  cookie: string;
  name: string;
  status: "starting" | "running" | "error" | "stopped";
}

const nodes = new Map<string, ManagedNode>();

function getDefaultHostLabel(): string | null {
  const first = sshHosts.keys().next();
  return first.done ? null : first.value;
}

async function defaultCookie(hostLabel: string): Promise<string> {
  try {
    const conn = await getSSHConnection(hostLabel);
    const cookie = await sshExecSimple(conn, "cat ~/.erlang.cookie", 5000);
    if (cookie) return cookie;
  } catch {
    // fall through
  }
  return "mcp_default_cookie";
}

function configGuard(): ReturnType<typeof error> | null {
  if (sshHosts.size === 0 || !SSH_PRIVATE_KEY) {
    return error("No SSH hosts configured. Set SSH_HOSTS and SSH_PRIVATE_KEY environment variables.");
  }
  return null;
}

// ── Cleanup ─────────────────────────────────────────────────────────────────

function cleanup() {
  for (const [, node] of nodes) {
    try { node.channel.close(); } catch {}
  }
  for (const [, hostConfig] of sshHosts) {
    try { hostConfig.connection?.end(); } catch {}
    hostConfig.connection = null;
  }
}

process.on("SIGINT", () => { cleanup(); process.exit(0); });
process.on("SIGTERM", () => { cleanup(); process.exit(0); });

// ── RPC Helpers ─────────────────────────────────────────────────────────────

async function rpcCall(targetNode: string, cookie: string, erlCode: string, hostLabel: string): Promise<string> {
  const conn = await getSSHConnection(hostLabel);
  const hostConfig = sshHosts.get(hostLabel)!;
  const erlPath = hostConfig.erlPath;
  const shortHost = hostConfig.remoteShortHost;

  const tmpName = `mcptmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const fullTarget = `${targetNode}@${shortHost}`;
  const fullTmp = `${tmpName}@${shortHost}`;

  const wrappedCode = `
    case net_adm:ping('${fullTarget}') of
      pong ->
        Res = rpc:call('${fullTarget}', erlang, apply, [fun() -> ${erlCode} end, []]),
        io:format("~s", [io_lib:format("~p", [Res])]),
        init:stop(0);
      pang ->
        io:format("error:node_unreachable"),
        init:stop(1)
    end.
  `.replace(/\n/g, " ");

  const command = `${erlPath} -sname ${tmpName} -setcookie ${cookie} -noshell -eval ${shellEscape(wrappedCode)}`;
  return sshExecSimple(conn, command, 10_000);
}

async function rpcRaw(targetNode: string, cookie: string, erlCode: string, hostLabel: string): Promise<string> {
  const conn = await getSSHConnection(hostLabel);
  const hostConfig = sshHosts.get(hostLabel)!;
  const erlPath = hostConfig.erlPath;
  const shortHost = hostConfig.remoteShortHost;

  const tmpName = `mcptmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const fullTarget = `${targetNode}@${shortHost}`;

  const wrappedCode = `
    case net_adm:ping('${fullTarget}') of
      pong ->
        rpc:call('${fullTarget}', erlang, apply, [fun() -> ${erlCode} end, []]),
        init:stop(0);
      pang ->
        io:format("error:node_unreachable"),
        init:stop(1)
    end.
  `.replace(/\n/g, " ");

  const command = `${erlPath} -sname ${tmpName} -setcookie ${cookie} -noshell -eval ${shellEscape(wrappedCode)}`;
  return sshExecSimple(conn, command, 10_000);
}

// ── Tools ───────────────────────────────────────────────────────────────────

// start-node
server.tool(
  {
    name: "start-node",
    description: "Start a new Erlang or Elixir BEAM node with the given short name",
    schema: z.object({
      name: z.string().describe("Short name for the node (e.g. 'worker1')"),
      type: z.enum(["erlang", "elixir"]).describe("Node type: erlang or elixir"),
      cookie: z.string().optional().describe("Erlang cookie (defaults to ~/.erlang.cookie)"),
      host: z.string().optional().describe("SSH host label (defaults to first configured host)"),
    }),
  },
  async ({ name, type, cookie: cookieArg, host }) => {
    const guard = configGuard();
    if (guard) return guard;

    const hostLabel = host || getDefaultHostLabel()!;
    const hostConfig = sshHosts.get(hostLabel);
    if (!hostConfig) {
      return error(`SSH host "${hostLabel}" not configured. Available: ${[...sshHosts.keys()].join(", ")}`);
    }

    if (nodes.has(name)) {
      return error(`Node "${name}" already exists (status: ${nodes.get(name)!.status})`);
    }

    let conn: Client;
    try {
      conn = await getSSHConnection(hostLabel);
    } catch (err) {
      return error(`Failed to connect to SSH host "${hostLabel}": ${err instanceof Error ? err.message : "Unknown error"}`);
    }

    const cookie = cookieArg || await defaultCookie(hostLabel);
    const shortHost = hostConfig.remoteShortHost;

    let command: string;
    if (type === "erlang") {
      command = `${hostConfig.erlPath} -sname ${name} -setcookie ${cookie} -noshell`;
    } else {
      command = `${hostConfig.elixirPath} --sname ${name} --cookie ${cookie} --no-halt`;
    }

    let channel: ClientChannel;
    try {
      channel = await sshExecLongRunning(conn, command);
    } catch (err) {
      return error(`Failed to start node on "${hostLabel}": ${err instanceof Error ? err.message : "Unknown error"}`);
    }

    const node: ManagedNode = {
      channel,
      hostLabel,
      remoteShortHost: shortHost,
      type,
      startedAt: Date.now(),
      cookie,
      name,
      status: "starting",
    };
    nodes.set(name, node);

    channel.on("close", () => {
      const n = nodes.get(name);
      if (n) n.status = "stopped";
    });

    // Ping after 2s to confirm the node is reachable
    setTimeout(async () => {
      const n = nodes.get(name);
      if (!n || n.status === "stopped") return;
      try {
        const pingConn = await getSSHConnection(hostLabel);
        const tmpName = `mcpchk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        const fullTarget = `${name}@${shortHost}`;
        const evalCode = `case net_adm:ping('${fullTarget}') of pong -> io:format("pong"), init:stop(0); pang -> io:format("pang"), init:stop(1) end.`;
        const pingCmd = `${hostConfig.erlPath} -sname ${tmpName} -setcookie ${cookie} -noshell -eval ${shellEscape(evalCode)}`;
        const result = await sshExecSimple(pingConn, pingCmd, 5000);
        const nn = nodes.get(name);
        if (nn && nn.status === "starting") {
          nn.status = result.trim() === "pong" ? "running" : "error";
        }
      } catch {
        const nn = nodes.get(name);
        if (nn) nn.status = "error";
      }
    }, 2000);

    return text(`Started ${type} node "${name}@${shortHost}" on host "${hostLabel}" with cookie "${cookie}". Status will update to "running" in ~2s after ping check.`);
  }
);

// stop-node
server.tool(
  {
    name: "stop-node",
    description: "Stop a running BEAM node by name",
    schema: z.object({
      name: z.string().describe("Short name of the node to stop"),
    }),
  },
  async ({ name }) => {
    const guard = configGuard();
    if (guard) return guard;

    const node = nodes.get(name);
    if (!node) {
      return error(`Node "${name}" not found. Use list-nodes to see active nodes.`);
    }

    try { node.channel.close(); } catch {}
    nodes.delete(name);

    return text(`Stopped and removed node "${name}@${node.remoteShortHost}" on host "${node.hostLabel}".`);
  }
);

// list-nodes
server.tool(
  {
    name: "list-nodes",
    description: "List all managed BEAM nodes with their status and process counts",
    schema: z.object({}),
    widget: {
      name: "node-dashboard",
      invoking: "Querying nodes...",
      invoked: "Node dashboard ready",
    },
  },
  async () => {
    const guard = configGuard();
    if (guard) return guard;

    const nodeList: Array<{
      name: string;
      type: "erlang" | "elixir";
      status: string;
      startedAt: number;
      processCount: number | null;
    }> = [];

    for (const [name, node] of nodes) {
      let processCount: number | null = null;

      if (node.status === "running") {
        try {
          const result = await rpcCall(name, node.cookie, "erlang:system_info(process_count)", node.hostLabel);
          const parsed = parseInt(result, 10);
          if (!isNaN(parsed)) processCount = parsed;
        } catch {
          // Node might have become unreachable
        }
      }

      nodeList.push({
        name,
        type: node.type,
        status: node.status,
        startedAt: node.startedAt,
        processCount,
      });
    }

    const summary = nodeList.length === 0
      ? "No managed nodes."
      : nodeList.map((n) => `${n.name} (${n.type}, ${n.status}${n.processCount != null ? `, ${n.processCount} procs` : ""})`).join("; ");

    return widget({
      props: { nodes: nodeList },
      output: text(`Managed nodes: ${summary}`),
    });
  }
);

// inspect-node
server.tool(
  {
    name: "inspect-node",
    description: "Inspect a BEAM node showing its registered processes and system info",
    schema: z.object({
      name: z.string().describe("Short name of the node to inspect"),
    }),
    widget: {
      name: "node-inspector",
      invoking: "Inspecting node...",
      invoked: "Node inspection ready",
    },
  },
  async ({ name }) => {
    const guard = configGuard();
    if (guard) return guard;

    const node = nodes.get(name);
    if (!node) {
      return error(`Node "${name}" not found. Use list-nodes to see active nodes.`);
    }
    if (node.status !== "running") {
      return error(`Node "${name}" is not running (status: ${node.status}). Cannot inspect.`);
    }

    const erlCode = `
      Names = erlang:registered(),
      lists:foreach(fun(N) ->
        Pid = whereis(N),
        case Pid of
          undefined -> ok;
          _ ->
            Info = erlang:process_info(Pid, [status, message_queue_len, memory, current_function]),
            case Info of
              undefined -> ok;
              _ ->
                Status = proplists:get_value(status, Info),
                MQL = proplists:get_value(message_queue_len, Info),
                Mem = proplists:get_value(memory, Info),
                {M, F, A} = proplists:get_value(current_function, Info),
                io:format("~s|~s|~p|~p|~s:~s/~p~n", [
                  atom_to_list(N),
                  atom_to_list(Status),
                  MQL,
                  Mem,
                  atom_to_list(M),
                  atom_to_list(F),
                  A
                ])
            end
        end
      end, Names),
      ok
    `.replace(/\n/g, " ");

    let output: string;
    try {
      output = await rpcRaw(name, node.cookie, erlCode, node.hostLabel);
    } catch (err) {
      return error(`Failed to inspect node "${name}": ${err instanceof Error ? err.message : "Unknown error"}`);
    }

    const processes = output
      .split("\n")
      .filter((line) => line.includes("|"))
      .map((line) => {
        const [pName, status, mqLen, memory, currentFn] = line.split("|");
        return {
          name: pName,
          status,
          messageQueueLen: parseInt(mqLen, 10) || 0,
          memory: parseInt(memory, 10) || 0,
          currentFunction: currentFn,
        };
      });

    const uptimeMs = Date.now() - node.startedAt;

    const summary = `Node "${name}" (${node.type}): ${processes.length} registered processes, uptime ${Math.round(uptimeMs / 1000)}s`;

    return widget({
      props: {
        nodeName: name,
        nodeType: node.type,
        uptime: uptimeMs,
        processes,
      },
      output: text(summary),
    });
  }
);

// ── Start ───────────────────────────────────────────────────────────────────

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3000;
console.log(`BEAM Node Manager running on port ${PORT}`);
server.listen(PORT);
