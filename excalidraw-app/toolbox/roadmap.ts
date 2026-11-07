import { ROUNDNESS, randomId } from "@excalidraw/common";
import {
  CaptureUpdateAction,
  convertToExcalidrawElements,
  newElementWith,
  newFrameElement,
} from "@excalidraw/element";
import { pointFrom } from "@excalidraw/math";

import type { LocalPoint } from "@excalidraw/math";

import type { ExcalidrawElementSkeleton } from "@excalidraw/element/transform";
import type {
  ExcalidrawElement,
  ExcalidrawFrameElement,
} from "@excalidraw/element/types";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

export type NodeKind = "topic" | "subtopic";
export type NodeStatus = "pending" | "learning" | "done" | "skip";
export type LinkType = "article" | "video" | "course" | "book" | "other";
export type RoadmapLink = { type: LinkType; title: string; url: string };
export type RoadmapNodeData = {
  kind: NodeKind;
  status: NodeStatus;
  description: string;
  links: RoadmapLink[];
};

const KIND_COLOR: Record<NodeKind, string> = {
  topic: "#ffd43b",
  subtopic: "#ffec99",
};
const STATUS_COLOR: Partial<Record<NodeStatus, string>> = {
  learning: "#a5d8ff",
  done: "#b2f2bb",
  skip: "#e9ecef",
};
const SIZE: Record<NodeKind, { width: number; height: number }> = {
  topic: { width: 200, height: 48 },
  subtopic: { width: 180, height: 40 },
};
const GAP = { topic: 60, subtopic: 12, side: 80 };
const FRAME_PADDING = 40;
const PROGRESS = / · \d+\/\d+$/;

type Box = { x: number; y: number; width: number; height: number };

export const isRoadmapNode = (element: ExcalidrawElement | null | undefined) =>
  element?.type === "rectangle" && !!element.customData?.roadmap;

export const getNodeData = (element: ExcalidrawElement) =>
  element.customData!.roadmap as RoadmapNodeData;

const isRoadmapFrame = (
  element: ExcalidrawElement,
): element is ExcalidrawFrameElement =>
  element.type === "frame" && !!element.customData?.roadmap;

const nodeStyle = ({ kind, status }: RoadmapNodeData) => ({
  backgroundColor: STATUS_COLOR[status] ?? KIND_COLOR[kind],
  opacity: status === "skip" ? 50 : 100,
});

const nodeSkeleton = (
  kind: NodeKind,
  x: number,
  y: number,
  text: string,
  frameId: string | null,
): ExcalidrawElementSkeleton & Box => {
  const data: RoadmapNodeData = {
    kind,
    status: "pending",
    description: "",
    links: [],
  };
  return {
    type: "rectangle",
    x,
    y,
    ...SIZE[kind],
    ...nodeStyle(data),
    fillStyle: "solid",
    strokeColor: "#1e1e1e",
    strokeWidth: 2,
    roughness: 0,
    roundness: { type: ROUNDNESS.ADAPTIVE_RADIUS },
    frameId,
    customData: { roadmap: data },
    label: { text, fontSize: 16 },
  };
};

/** a topic's arrow runs down from `from`, a subtopic's line to its right */
const edgeSkeleton = (
  kind: NodeKind,
  from: Box & { id: string },
  to: Box & { id: string },
  frameId: string | null,
): ExcalidrawElementSkeleton => {
  const [x, y, endX, endY] =
    kind === "topic"
      ? [
          from.x + from.width / 2,
          from.y + from.height,
          to.x + to.width / 2,
          to.y,
        ]
      : [
          from.x + from.width,
          from.y + from.height / 2,
          to.x,
          to.y + to.height / 2,
        ];
  return {
    type: "arrow",
    x,
    y,
    points: [
      pointFrom<LocalPoint>(0, 0),
      pointFrom<LocalPoint>(endX - x, endY - y),
    ],
    strokeColor: "#1971c2",
    strokeWidth: 2,
    roughness: 0,
    strokeStyle: kind === "topic" ? "solid" : "dotted",
    endArrowhead: kind === "topic" ? "arrow" : null,
    frameId,
    start: { id: from.id },
    end: { id: to.id },
  };
};

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width &&
  b.x < a.x + a.width &&
  a.y < b.y + b.height &&
  b.y < a.y + a.height;

/** grows `frame` to fit `elements` */
const fitFrame = (
  frame: ExcalidrawFrameElement,
  elements: readonly ExcalidrawElement[],
) => {
  const right = Math.max(...elements.map((el) => el.x + el.width));
  const bottom = Math.max(...elements.map((el) => el.y + el.height));
  return newElementWith(frame, {
    width: Math.max(frame.width, right + FRAME_PADDING - frame.x),
    height: Math.max(frame.height, bottom + FRAME_PADDING - frame.y),
  });
};

export const insertRoadmap = (api: ExcalidrawImperativeAPI) => {
  const { scrollX, scrollY, zoom, width, height } = api.getAppState();
  const x = width / 2 / zoom.value - scrollX - SIZE.topic.width / 2;
  const y = height / 2 / zoom.value - scrollY - 100;
  const frame = newFrameElement({
    x: x - FRAME_PADDING,
    y: y - FRAME_PADDING,
    width: SIZE.topic.width + FRAME_PADDING * 2,
    height: SIZE.topic.height * 2 + GAP.topic + FRAME_PADDING * 2,
    name: "My goal",
    customData: { roadmap: true },
  });
  const [first, second] = ["Start here", "Next step"].map((text, i) => ({
    ...nodeSkeleton(
      "topic",
      x,
      y + i * (SIZE.topic.height + GAP.topic),
      text,
      frame.id,
    ),
    id: randomId(),
  }));
  const elements = convertToExcalidrawElements(
    [first, second, edgeSkeleton("topic", first, second, frame.id)],
    { regenerateIds: false },
  ).map((el) => ({ ...el, frameId: frame.id }));
  api.updateScene({
    elements: [...api.getSceneElementsIncludingDeleted(), frame, ...elements],
    appState: { selectedElementIds: {} },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
};

/** adds a topic below `from`, or a subtopic to its right, bound to it */
export const addNode = (
  api: ExcalidrawImperativeAPI,
  from: ExcalidrawElement,
  kind: NodeKind,
) => {
  const scene = api.getSceneElementsIncludingDeleted();
  const siblings = scene.filter(
    (el) => !el.isDeleted && el.frameId === from.frameId && isRoadmapNode(el),
  );
  const { width, height } = SIZE[kind];
  const spot = {
    x:
      kind === "topic"
        ? from.x + (from.width - width) / 2
        : from.x + from.width + GAP.side,
    y: kind === "topic" ? from.y + from.height + GAP.topic : from.y,
    width,
    height,
  };
  while (siblings.some((el) => overlaps(el, spot))) {
    spot.y += height + GAP[kind];
  }

  const id = randomId();
  // a stand-in for `from`, only so the arrow binds to it
  const [, ...added] = convertToExcalidrawElements(
    [
      {
        type: "rectangle",
        id: from.id,
        x: from.x,
        y: from.y,
        width: from.width,
        height: from.height,
      },
      { ...nodeSkeleton(kind, spot.x, spot.y, "New step", from.frameId), id },
      edgeSkeleton(kind, from, { ...spot, id }, from.frameId),
    ],
    { regenerateIds: false },
  ).map((el) => ({ ...el, frameId: from.frameId }));
  const edge = added.find((el) => el.type === "arrow")!;

  api.updateScene({
    elements: [
      ...scene.map((el) =>
        el.id === from.id
          ? newElementWith(el, {
              boundElements: [
                ...(el.boundElements ?? []),
                { id: edge.id, type: "arrow" },
              ],
            })
          : el.id === from.frameId && isRoadmapFrame(el)
          ? fitFrame(el, added)
          : el,
      ),
      ...added,
    ],
    appState: { selectedElementIds: { [id]: true } },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
};

export const updateNode = (
  api: ExcalidrawImperativeAPI,
  id: string,
  patch: Partial<RoadmapNodeData>,
) => {
  api.updateScene({
    elements: api.getSceneElementsIncludingDeleted().map((el) => {
      if (el.id !== id) {
        return el;
      }
      const data = { ...getNodeData(el), ...patch };
      return newElementWith(el, {
        ...((patch.status || patch.kind) && nodeStyle(data)),
        customData: { ...el.customData, roadmap: data },
      });
    }),
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
};

/** keeps "done/total" at the end of each roadmap frame's name */
export const registerRoadmap = (api: ExcalidrawImperativeAPI) =>
  api.onChange((elements, appState) => {
    const names = new Map<string, string>();
    for (const frame of elements.filter(isRoadmapFrame)) {
      if (frame.isDeleted || appState.editingFrame === frame.id) {
        continue;
      }
      const statuses = elements
        .filter(
          (el) => !el.isDeleted && el.frameId === frame.id && isRoadmapNode(el),
        )
        .map((el) => getNodeData(el).status)
        .filter((status) => status !== "skip");
      const done = statuses.filter((status) => status === "done").length;
      const name = `${(frame.name ?? "Roadmap").replace(
        PROGRESS,
        "",
      )} · ${done}/${statuses.length}`;
      if (name !== frame.name) {
        names.set(frame.id, name);
      }
    }
    if (names.size) {
      api.updateScene({
        elements: elements.map((el) =>
          isRoadmapFrame(el) && names.has(el.id)
            ? newElementWith(el, { name: names.get(el.id)! })
            : el,
        ),
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    }
  });
