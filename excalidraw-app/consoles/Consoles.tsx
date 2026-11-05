import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import { useEffect, useRef, useState } from "react";

import { EVENT, KEYS } from "@excalidraw/common";
import { Sidebar, useExcalidrawAPI } from "@excalidraw/excalidraw";
import { useApp } from "@excalidraw/excalidraw/components/App";

import "@xterm/xterm/css/xterm.css";

import "./Consoles.scss";

const SIDEBAR_NAME = "consoles";
const STORAGE_KEY = "excalidraw-consoles";

// outlive the sidebar, which unmounts its children when closed
const sessions = new Map<
  string,
  { term: Terminal; fit: FitAddon; host: HTMLElement; socket: WebSocket }
>();

const socketUrl = (doc: Document, id: string) =>
  `ws://${doc.location.host}/api/consoles?id=${id}`;

const getSession = (doc: Document, id: string) => {
  const existing = sessions.get(id);
  if (existing) {
    return existing;
  }
  const host = doc.createElement("div");
  host.className = "consoles__host";
  // keys belong to the shell: Esc must reach the agent, not close the sidebar
  host.addEventListener(EVENT.KEYDOWN, (event) => event.stopPropagation());

  const term = new Terminal({
    fontFamily: "Menlo, monospace",
    fontSize: 12,
    scrollback: 10000,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);

  const socket = new WebSocket(socketUrl(doc, id));
  const send = (message: object) => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
    }
  };
  const sendSize = () => send({ cols: term.cols, rows: term.rows });
  socket.onopen = sendSize;
  // the first message replays old output: xterm answers any terminal queries in
  // it, and those answers would land in the running program as typed input
  let replayed = false;
  socket.onmessage = (event) =>
    term.write(event.data, () => {
      replayed = true;
    });
  socket.onclose = () => term.write("\r\n[console closed]\r\n");
  term.onResize(sendSize);
  term.onData((input) => {
    if (replayed) {
      send({ input });
    }
  });

  const session = { term, fit, host, socket };
  sessions.set(id, session);
  return session;
};

const ConsoleView = ({ id }: { id: string }) => {
  const parentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const parent = parentRef.current!;
    const { term, fit, host } = getSession(parent.ownerDocument, id);
    parent.replaceChildren(host);
    if (!term.element) {
      term.open(host);
    }
    fit.fit();
    term.focus();
    const observer = new ResizeObserver(() => fit.fit());
    observer.observe(parent);
    return () => observer.disconnect();
  }, [id]);

  return <div ref={parentRef} className="consoles__view" />;
};

const ConsolesSidebar = () => {
  const app = useApp();
  const excalidrawAPI = useExcalidrawAPI();
  const [ids, setIds] = useState<string[]>(
    () =>
      JSON.parse(
        app.ownerWindow.localStorage.getItem(STORAGE_KEY) ?? "null",
      ) ?? [crypto.randomUUID()],
  );
  const [active, setActive] = useState(ids[0]);

  useEffect(() => {
    app.ownerWindow.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  }, [app, ids]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // `code` so it also fires on non-latin layouts
      if (event[KEYS.CTRL_OR_CMD] && event.shiftKey && event.code === "KeyE") {
        // capture phase: runs before the editor's own binding (image export)
        event.preventDefault();
        event.stopPropagation();
        excalidrawAPI?.toggleSidebar({ name: SIDEBAR_NAME });
      }
    };
    const win = app.ownerWindow;
    win.addEventListener(EVENT.KEYDOWN, onKeyDown, true);
    return () => win.removeEventListener(EVENT.KEYDOWN, onKeyDown, true);
  }, [app, excalidrawAPI]);

  const addConsole = () => {
    const id = crypto.randomUUID();
    setIds([...ids, id]);
    setActive(id);
  };

  const closeConsole = (id: string) => {
    const session = sessions.get(id);
    if (session) {
      session.socket.onclose = null;
      session.socket.close();
      session.term.dispose();
      sessions.delete(id);
    }
    // its own socket, since a console restored after a reload may not have one yet
    new WebSocket(`${socketUrl(app.ownerDocument, id)}&kill`);
    const remaining = ids.filter((other) => other !== id);
    if (!remaining.length) {
      remaining.push(crypto.randomUUID());
    }
    setIds(remaining);
    if (id === active) {
      setActive(remaining[0]);
    }
  };

  const variant = new URLSearchParams(app.ownerWindow.location.search).get("v");

  return (
    <Sidebar
      name={SIDEBAR_NAME}
      docked
      className={`consoles-sidebar consoles-sidebar--v${variant}`}
    >
      <Sidebar.Header>
        <div className="consoles__tabs">
          {ids.map((id, index) => (
            <span
              key={id}
              className={`consoles__tab${id === active ? " is-active" : ""}`}
            >
              <button type="button" onClick={() => setActive(id)}>
                {index + 1}
              </button>
              <button
                type="button"
                title="Close console"
                onClick={() => closeConsole(id)}
              >
                ×
              </button>
            </span>
          ))}
          <button type="button" title="New console" onClick={addConsole}>
            +
          </button>
        </div>
      </Sidebar.Header>
      <ConsoleView id={active} />
    </Sidebar>
  );
};

export default ConsolesSidebar;
