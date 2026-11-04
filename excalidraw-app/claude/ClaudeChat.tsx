import { useEffect, useRef, useState } from "react";

import {
  CaptureUpdateAction,
  restoreElements,
  useExcalidrawAPI,
} from "@excalidraw/excalidraw";
import { createIcon } from "@excalidraw/excalidraw/components/icons";
import { bumpVersion } from "@excalidraw/element";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { appJotaiStore, atom, useAtomValue } from "../app-jotai";

import "./ClaudeChat.scss";

export const claudeIcon = createIcon(
  <path d="M16 18a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2zm0 -12a2 2 0 0 1 2 2a2 2 0 0 1 2 -2a2 2 0 0 1 -2 -2a2 2 0 0 1 -2 2zm-7 12a6 6 0 0 1 6 -6a6 6 0 0 1 -6 -6a6 6 0 0 1 -6 6a6 6 0 0 1 6 6z" />,
  {
    width: 24,
    height: 24,
    fill: "none",
    strokeWidth: 2,
    stroke: "currentColor",
    strokeLinecap: "round",
    strokeLinejoin: "round",
  },
);

type Message = {
  role: "user" | "assistant" | "tool" | "error";
  text: string;
  images?: string[];
};

const newChat = () => ({
  chatId: crypto.randomUUID(),
  messages: [] as Message[],
  running: false,
});

const chatAtom = atom(newChat());

let abortController: AbortController | null = null;

const update = (fn: (chat: ReturnType<typeof newChat>) => object) =>
  appJotaiStore.set(chatAtom, (chat) => ({ ...chat, ...fn(chat) }));

const addMessage = (message: Message) =>
  update((chat) => ({ messages: [...chat.messages, message] }));

const send = async (
  excalidrawAPI: ExcalidrawImperativeAPI,
  text: string,
  images: string[],
) => {
  const { chatId, messages } = appJotaiStore.get(chatAtom);
  addMessage({ role: "user", text, images });
  update(() => ({ running: true }));
  abortController = new AbortController();
  try {
    const res = await fetch("/api/claude", {
      method: "POST",
      signal: abortController.signal,
      body: JSON.stringify({
        chatId,
        resume: messages.length > 0,
        text,
        images,
        elements: excalidrawAPI.getSceneElements(),
      }),
    });
    if (!res.ok || !res.body) {
      throw new Error(`HTTP ${res.status}`);
    }
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = "";
    for (;;) {
      const { done, value } = await reader.read();
      buffer += value ?? "";
      const lines = buffer.split("\n");
      buffer = done ? "" : lines.pop()!;
      for (const line of lines.filter(Boolean).map((l) => JSON.parse(l))) {
        if (line.type === "assistant") {
          for (const block of line.message.content) {
            if (block.type === "text") {
              addMessage({ role: "assistant", text: block.text });
            } else if (block.type === "tool_use") {
              const { file_path, command } = block.input;
              addMessage({
                role: "tool",
                text: `${block.name} ${
                  file_path?.split("/").pop() ?? command ?? ""
                }`,
              });
            }
          }
        } else if (line.type === "result" && line.is_error) {
          addMessage({ role: "error", text: line.result });
        } else if (line.type === "error") {
          addMessage({ role: "error", text: line.message });
        } else if (line.type === "diagram") {
          const elements = restoreElements(line.elements, null, {
            refreshDimensions: true,
            repairBindings: true,
          });
          // Claude may reuse ids of deleted elements: version past the scene's
          const scene = excalidrawAPI.getSceneElementsMapIncludingDeleted();
          elements.forEach((el) => bumpVersion(el, scene.get(el.id)?.version));
          excalidrawAPI.updateScene({
            elements,
            captureUpdate: CaptureUpdateAction.IMMEDIATELY,
          });
          excalidrawAPI.setViewport({ target: elements });
        }
      }
      if (done) {
        break;
      }
    }
  } catch (error: any) {
    if (error.name !== "AbortError") {
      addMessage({ role: "error", text: error.message });
    }
  } finally {
    update(() => ({ running: false }));
  }
};

export const ClaudeChat = () => {
  const excalidrawAPI = useExcalidrawAPI();
  const { messages, running } = useAtomValue(chatAtom);
  const [text, setText] = useState("");
  const [images, setImages] = useState<string[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [messages]);

  const addImages = async (files: File[]) => {
    const urls = await Promise.all(
      files.map(
        (file) =>
          new Promise<string>((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.readAsDataURL(file);
          }),
      ),
    );
    setImages((prev) => [...prev, ...urls]);
  };

  const submit = () => {
    if (!excalidrawAPI || running || !(text.trim() || images.length)) {
      return;
    }
    send(excalidrawAPI, text.trim(), images);
    setText("");
    setImages([]);
  };

  return (
    <div className="claude-chat">
      <div ref={list} className="claude-chat__messages">
        {messages.map((message, i) => (
          <div key={i} className={`claude-chat__message is-${message.role}`}>
            {message.images?.map((src, j) => (
              <img key={j} src={src} alt="" />
            ))}
            {message.text}
          </div>
        ))}
      </div>
      <div className="claude-chat__composer">
        {images.length > 0 && (
          <div className="claude-chat__images">
            {images.map((src, i) => (
              <img
                key={i}
                src={src}
                alt="Remove"
                title="Remove"
                onClick={() => setImages(images.filter((_, j) => j !== i))}
              />
            ))}
          </div>
        )}
        <textarea
          value={text}
          rows={3}
          placeholder="Describe a diagram or paste an image"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          onPaste={(e) => {
            const files = [...e.clipboardData.files].filter((file) =>
              file.type.startsWith("image/"),
            );
            if (files.length) {
              e.preventDefault();
              addImages(files);
            }
          }}
        />
        <input
          ref={fileInput}
          type="file"
          accept="image/*"
          multiple
          hidden
          onChange={(e) => {
            addImages([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
        <div className="claude-chat__buttons">
          <button type="button" onClick={() => fileInput.current?.click()}>
            Attach
          </button>
          <button
            type="button"
            onClick={() => {
              abortController?.abort();
              appJotaiStore.set(chatAtom, newChat());
            }}
          >
            New chat
          </button>
          <button
            type="button"
            className="is-primary"
            onClick={running ? () => abortController?.abort() : submit}
          >
            {running ? "Stop" : "Send"}
          </button>
        </div>
      </div>
    </div>
  );
};
