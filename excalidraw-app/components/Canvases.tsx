import {
  PlusIcon,
  TrashIcon,
  pencilIcon,
} from "@excalidraw/excalidraw/components/icons";
import clsx from "clsx";
import { useEffect, useState } from "react";

import { useAtomValue } from "../app-jotai";
import {
  createCanvas,
  currentCanvasIdAtom,
  deleteCanvas,
  goToCanvas,
  renameCanvas,
  subscribeToCanvases,
} from "../data/canvases";

import "./Canvases.scss";

import type { Canvas } from "../data/canvases";

export const Canvases = () => {
  const currentId = useAtomValue(currentCanvasIdAtom);
  const [canvases, setCanvases] = useState<Canvas[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);

  useEffect(() => subscribeToCanvases(setCanvases), []);

  const remove = async (canvas: Canvas) => {
    if (!window.confirm(`Delete "${canvas.name}"?`)) {
      return;
    }
    await deleteCanvas(canvas.id);
    if (canvas.id === currentId) {
      const next = canvases.find((other) => other.id !== canvas.id);
      goToCanvas(next?.id);
    }
  };

  return (
    <div className="canvases">
      <button
        type="button"
        className="canvases__new"
        onClick={async () => goToCanvas(await createCanvas())}
      >
        {PlusIcon}
        New canvas
      </button>
      <ul className="canvases__list">
        {canvases.map((canvas) => (
          <li
            key={canvas.id}
            className={clsx("canvases__item", {
              "canvases__item--active": canvas.id === currentId,
            })}
          >
            {editingId === canvas.id ? (
              <input
                className="canvases__name-input"
                autoFocus
                defaultValue={canvas.name}
                onFocus={(event) => event.target.select()}
                onBlur={(event) => {
                  const name = event.target.value.trim();
                  setEditingId(null);
                  if (name && name !== canvas.name) {
                    renameCanvas(canvas.id, name);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.currentTarget.value = canvas.name;
                  }
                  if (event.key === "Enter" || event.key === "Escape") {
                    event.currentTarget.blur();
                  }
                }}
              />
            ) : (
              <button
                type="button"
                className="canvases__open"
                onClick={() => goToCanvas(canvas.id)}
              >
                <span className="canvases__name">{canvas.name}</span>
                <span className="canvases__date">
                  {new Date(canvas.updatedAt).toLocaleDateString()}
                </span>
              </button>
            )}
            <button
              type="button"
              className="canvases__action"
              title="Rename"
              onClick={() => setEditingId(canvas.id)}
            >
              {pencilIcon}
            </button>
            <button
              type="button"
              className="canvases__action"
              title="Delete"
              onClick={() => remove(canvas)}
            >
              {TrashIcon}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
};
