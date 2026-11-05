import path from "path";

import { WebSocketServer } from "ws";

import type { IPty } from "node-pty";
import type { Plugin } from "vite";
import type { WebSocket } from "ws";

const ROOT = path.resolve(__dirname, "../..");
const MAX_OUTPUT = 1_000_000;
// a new terminal window's starting point; the rest of our env is yarn's and vite's
const INHERITED_ENV = [
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "TMPDIR",
  "SSH_AUTH_SOCK",
];
const LOOPBACK = ["127.0.0.1", "::1", "::ffff:127.0.0.1"];

type Session = { shell: IPty; output: string; socket?: WebSocket };

export const consolesPlugin = (): Plugin => ({
  name: "excalidraw-consoles",
  apply: "serve",
  async configureServer(server) {
    // not a top-level import: `vite build` loads this file where node-pty may not compile
    const pty = await import("node-pty");
    const wss = new WebSocketServer({ noServer: true });
    // keyed by console id, so shells survive page reloads
    const sessions = new Map<string, Session>();

    server.httpServer?.on("close", () => {
      sessions.forEach((session) => session.shell.kill());
    });

    server.httpServer?.on("upgrade", (req, socket, head) => {
      const url = new URL(req.url!, "http://localhost");
      if (url.pathname !== "/api/consoles") {
        return;
      }
      // this socket is a shell, and any website can open a websocket to localhost:
      // only accept our own page, by name (not rebound DNS), from this machine
      const { host, origin } = req.headers;
      if (
        origin !== `http://${host}` ||
        !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host ?? "") ||
        !LOOPBACK.includes(req.socket.remoteAddress ?? "")
      ) {
        socket.destroy();
        return;
      }

      wss.handleUpgrade(req, socket, head, (ws) => {
        const id = url.searchParams.get("id")!;
        if (url.searchParams.has("kill")) {
          sessions.get(id)?.shell.kill();
          ws.close();
          return;
        }

        let session = sessions.get(id);
        if (!session) {
          const shell = pty.spawn(process.env.SHELL!, ["-l"], {
            name: "xterm-256color",
            cwd: ROOT,
            env: {
              ...Object.fromEntries(
                INHERITED_ENV.filter((key) => process.env[key]).map((key) => [
                  key,
                  process.env[key],
                ]),
              ),
              COLORTERM: "truecolor",
            },
          });
          const created: Session = { shell, output: "" };
          shell.onData((data) => {
            created.output = (created.output + data).slice(-MAX_OUTPUT);
            created.socket?.send(data);
          });
          shell.onExit(() => {
            sessions.delete(id);
            created.socket?.terminate();
          });
          sessions.set(id, created);
          session = created;
        }

        const { shell } = session;
        session.socket?.close();
        session.socket = ws;
        ws.send(session.output);
        ws.on("message", (raw) => {
          const { input, cols, rows } = JSON.parse(raw.toString());
          if (input !== undefined) {
            shell.write(input);
          } else {
            shell.resize(cols, rows);
          }
        });
      });
    });
  },
});
