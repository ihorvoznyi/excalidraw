import { spawn } from "child_process";
import fs from "fs/promises";
import os from "os";
import path from "path";

import type { Plugin } from "vite";

const SYSTEM = `You turn requests into Excalidraw diagrams. diagram.excalidraw in the working directory is the user's canvas ({"type":"excalidraw","version":2,"elements":[...]}).
- Edit that file to fulfil each request. Keep elements you weren't asked to change; new elements need unique ids. Put new content beside existing content, not on top of it.
- Minimal elements are fine: id, type, x, y, width, height, plus strokeColor/backgroundColor/fillStyle as needed. Text: text, originalText, fontSize, fontFamily 5.
- Shape labels: a text element whose containerId is the shape, listed in the shape's boundElements as {type:"text",id}.
- Arrows: points relative to x/y, startBinding/endBinding {elementId}, and listed in both shapes' boundElements as {type:"arrow",id}.
- Attached images are files in the working directory: read them and reproduce their content as elements.
- Change the file with Write/Edit only. The one shell command you may run, on its own, is \`excalidraw render diagram.excalidraw --out preview.png\`.
- After editing, render, read preview.png, and fix overlaps, clipped text or crossing arrows before replying.
- Reply in one or two sentences.`;

const binDir = path.resolve(__dirname, "../../node_modules/.bin");

export const claudePlugin = (): Plugin => ({
  name: "excalidraw-claude",
  apply: "serve",
  configureServer(server) {
    server.middlewares.use("/api/claude", async (req, res) => {
      if (req.method !== "POST") {
        res.statusCode = 405;
        return res.end();
      }
      if (req.headers["sec-fetch-site"] !== "same-origin") {
        res.statusCode = 403;
        return res.end();
      }
      let body = "";
      for await (const chunk of req) {
        body += chunk;
      }
      const { chatId, resume, text, images, elements } = JSON.parse(body);

      const dir = path.join(os.tmpdir(), "excalidraw-claude", chatId);
      await fs.mkdir(dir, { recursive: true });
      const written = JSON.stringify({
        type: "excalidraw",
        version: 2,
        elements,
      });
      await fs.writeFile(path.join(dir, "diagram.excalidraw"), written);
      const names: string[] = await Promise.all(
        (images as string[]).map(async (dataUrl, i) => {
          const ext = /^data:image\/(\w+)/.exec(dataUrl)?.[1] ?? "png";
          const name = `image-${Date.now()}-${i}.${ext}`;
          await fs.writeFile(
            path.join(dir, name),
            Buffer.from(dataUrl.split(",")[1], "base64"),
          );
          return name;
        }),
      );
      const prompt = names.length
        ? `${text}\n\nAttached images: ${names.join(", ")}`
        : text;

      const child = spawn(
        "claude",
        [
          "-p",
          "--safe-mode",
          "--output-format",
          "stream-json",
          "--verbose",
          "--tools",
          "Read,Write,Edit,Bash",
          "--allowedTools",
          "Read",
          "Write",
          "Edit",
          "Bash(excalidraw render *)",
          "--permission-mode",
          "dontAsk",
          "--append-system-prompt",
          SYSTEM,
          ...(resume ? ["--resume", chatId] : ["--session-id", chatId]),
        ],
        {
          cwd: dir,
          env: {
            ...process.env,
            PATH: `${binDir}${path.delimiter}${process.env.PATH}`,
          },
        },
      );
      res.setHeader("content-type", "application/x-ndjson");
      const send = (line: object) => res.write(`${JSON.stringify(line)}\n`);
      let stderr = "";
      child.stderr.on("data", (d) => (stderr += d));
      child.stdout.pipe(res, { end: false });
      child.stdin.end(prompt);
      res.on("close", () => child.kill());
      // `close` still follows, with a non-zero code
      child.on("error", (e) => (stderr += e.message));
      child.on("close", async (code) => {
        try {
          const now = await fs.readFile(
            path.join(dir, "diagram.excalidraw"),
            "utf8",
          );
          if (now !== written) {
            send({ type: "diagram", elements: JSON.parse(now).elements });
          }
        } catch (e: any) {
          send({ type: "error", message: `diagram.excalidraw: ${e.message}` });
        }
        if (code) {
          send({
            type: "error",
            message: stderr || `claude exited with code ${code}`,
          });
        }
        res.end();
      });
    });
  },
});
