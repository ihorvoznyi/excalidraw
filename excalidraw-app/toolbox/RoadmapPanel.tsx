import { arrayToMap, normalizeLink } from "@excalidraw/common";
import { useExcalidrawAPI } from "@excalidraw/excalidraw";
import { CloseIcon, TrashIcon } from "@excalidraw/excalidraw/components/icons";
import { getBoundTextElement } from "@excalidraw/element";
import clsx from "clsx";
import { useEffect, useState } from "react";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { addNode, getNodeData, isRoadmapNode, updateNode } from "./roadmap";

import "./RoadmapPanel.scss";

import type { LinkType, NodeStatus } from "./roadmap";

const STATUSES: { status: NodeStatus; label: string }[] = [
  { status: "learning", label: "Learning" },
  { status: "done", label: "Done" },
  { status: "skip", label: "Skip" },
];
const LINK_TYPES: LinkType[] = ["article", "video", "course", "book", "other"];

/** the selected roadmap node's status, notes and links */
export const RoadmapPanel = () => {
  const api = useExcalidrawAPI();
  const [node, setNode] = useState<{
    element: ExcalidrawElement;
    title: string;
  } | null>(null);
  const [linkType, setLinkType] = useState<LinkType>("article");

  useEffect(
    () =>
      api?.onChange((elements, appState) => {
        const ids = Object.keys(appState.selectedElementIds);
        const element =
          ids.length === 1 && !appState.editingTextElement
            ? elements.find((el) => el.id === ids[0] && !el.isDeleted)
            : undefined;
        setNode((prev) =>
          isRoadmapNode(element)
            ? prev?.element === element
              ? prev
              : {
                  element: element!,
                  title:
                    getBoundTextElement(element!, arrayToMap(elements))
                      ?.originalText ?? "",
                }
            : null,
        );
      }),
    [api],
  );

  if (!api || !node) {
    return null;
  }
  const { element, title } = node;
  const data = getNodeData(element);
  const update = (patch: Parameters<typeof updateNode>[2]) =>
    updateNode(api, element.id, patch);

  return (
    <div className="roadmap-panel" key={element.id}>
      <header className="roadmap-panel__header">
        <h2>{title || "Untitled"}</h2>
        <button
          type="button"
          title="Close"
          onClick={() =>
            api.updateScene({ appState: { selectedElementIds: {} } })
          }
        >
          {CloseIcon}
        </button>
      </header>

      <div className="roadmap-panel__row">
        {(["topic", "subtopic"] as const).map((kind) => (
          <button
            key={kind}
            type="button"
            className={clsx({ active: data.kind === kind })}
            onClick={() => update({ kind })}
          >
            {kind === "topic" ? "Topic" : "Subtopic"}
          </button>
        ))}
      </div>

      <div className="roadmap-panel__row">
        {STATUSES.map(({ status, label }) => (
          <button
            key={status}
            type="button"
            className={clsx(`status--${status}`, {
              active: data.status === status,
            })}
            onClick={() =>
              update({ status: data.status === status ? "pending" : status })
            }
          >
            {label}
          </button>
        ))}
      </div>

      <textarea
        placeholder="Why this step matters, what “done” means…"
        defaultValue={data.description}
        onBlur={(event) => {
          if (event.target.value !== data.description) {
            update({ description: event.target.value });
          }
        }}
      />

      <ul className="roadmap-panel__links">
        {data.links.map((link, i) => (
          <li key={i}>
            <span className="roadmap-panel__badge">{link.type}</span>
            <a href={normalizeLink(link.url)} target="_blank" rel="noreferrer">
              {link.title || link.url}
            </a>
            <button
              type="button"
              title="Remove link"
              onClick={() =>
                update({ links: data.links.filter((_, j) => j !== i) })
              }
            >
              {TrashIcon}
            </button>
          </li>
        ))}
      </ul>
      <form
        className="roadmap-panel__add-link"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const url = form.url.value.trim();
          if (url) {
            update({
              links: [
                ...data.links,
                { type: linkType, url, title: form.linkTitle.value.trim() },
              ],
            });
            form.reset();
          }
        }}
      >
        <select
          value={linkType}
          onChange={(event) => setLinkType(event.target.value as LinkType)}
        >
          {LINK_TYPES.map((type) => (
            <option key={type}>{type}</option>
          ))}
        </select>
        <input name="url" placeholder="https://…" />
        <input name="linkTitle" placeholder="Title (optional)" />
        <button type="submit">Add link</button>
      </form>

      <div className="roadmap-panel__row">
        <button type="button" onClick={() => addNode(api, element, "topic")}>
          + Topic below
        </button>
        <button type="button" onClick={() => addNode(api, element, "subtopic")}>
          + Subtopic
        </button>
      </div>
    </div>
  );
};
