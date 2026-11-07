import {
  LoadIcon,
  PlusIcon,
  TrashIcon,
  chevronDownIcon,
  chevronRight,
  pencilIcon,
} from "@excalidraw/excalidraw/components/icons";
import clsx from "clsx";
import { useEffect, useState } from "react";

import { useAtomValue } from "../app-jotai";
import {
  createCanvas,
  createProject,
  currentCanvasIdAtom,
  deleteCanvas,
  deleteProject,
  goToCanvas,
  moveCanvas,
  renameCanvas,
  renameProject,
  subscribeToCanvases,
  subscribeToProjects,
} from "../data/canvases";

import "./Canvases.scss";

import type { Canvas, Project } from "../data/canvases";

const NameInput = ({
  name,
  onDone,
}: {
  name: string;
  onDone: (name: string) => void;
}) => (
  <input
    className="canvases__name-input"
    autoFocus
    defaultValue={name}
    onFocus={(event) => event.target.select()}
    onBlur={(event) => onDone(event.target.value.trim())}
    onKeyDown={(event) => {
      if (event.key === "Escape") {
        event.currentTarget.value = name;
      }
      if (event.key === "Enter" || event.key === "Escape") {
        event.currentTarget.blur();
      }
    }}
  />
);

export const Canvases = () => {
  const currentId = useAtomValue(currentCanvasIdAtom);
  const [canvases, setCanvases] = useState<Canvas[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => subscribeToCanvases(setCanvases), []);
  useEffect(() => subscribeToProjects(setProjects), []);

  const projectIds = new Set(projects.map((project) => project.id));
  const canvasesIn = (projectId?: string) =>
    canvases.filter((canvas) =>
      projectId
        ? canvas.projectId === projectId
        : !canvas.projectId || !projectIds.has(canvas.projectId),
    );

  const newCanvas = async (projectId?: string) =>
    goToCanvas(await createCanvas([], {}, projectId));

  const toggle = (id: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

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

  const removeProject = (project: Project) => {
    if (
      window.confirm(`Delete project "${project.name}"? Its canvases are kept.`)
    ) {
      deleteProject(
        project.id,
        canvasesIn(project.id).map((canvas) => canvas.id),
      );
    }
  };

  const renderCanvas = (canvas: Canvas) => (
    <li
      key={canvas.id}
      className={clsx("canvases__item", {
        "canvases__item--active": canvas.id === currentId,
      })}
    >
      {editingId === canvas.id ? (
        <NameInput
          name={canvas.name}
          onDone={(name) => {
            setEditingId(null);
            if (name && name !== canvas.name) {
              renameCanvas(canvas.id, name);
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
      <label className="canvases__action" title="Move to project">
        {LoadIcon}
        <select
          value={canvas.projectId ?? ""}
          onChange={(event) =>
            moveCanvas(canvas.id, event.target.value || null)
          }
        >
          <option value="">No project</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
      </label>
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
  );

  return (
    <div className="canvases">
      <div className="canvases__buttons">
        <button
          type="button"
          className="canvases__new"
          onClick={() => newCanvas()}
        >
          {PlusIcon}
          New canvas
        </button>
        <button
          type="button"
          className="canvases__new"
          onClick={async () => setEditingId(await createProject())}
        >
          {LoadIcon}
          New project
        </button>
      </div>
      {projects.map((project) => (
        <div key={project.id} className="canvases__project">
          <div className="canvases__item">
            {editingId === project.id ? (
              <NameInput
                name={project.name}
                onDone={(name) => {
                  setEditingId(null);
                  if (name && name !== project.name) {
                    renameProject(project.id, name);
                  }
                }}
              />
            ) : (
              <button
                type="button"
                className="canvases__open canvases__project-name"
                onClick={() => toggle(project.id)}
              >
                {collapsed.has(project.id) ? chevronRight : chevronDownIcon}
                <span className="canvases__name">{project.name}</span>
                <span className="canvases__date">
                  {canvasesIn(project.id).length}
                </span>
              </button>
            )}
            <button
              type="button"
              className="canvases__action"
              title="New canvas in project"
              onClick={() => newCanvas(project.id)}
            >
              {PlusIcon}
            </button>
            <button
              type="button"
              className="canvases__action"
              title="Rename"
              onClick={() => setEditingId(project.id)}
            >
              {pencilIcon}
            </button>
            <button
              type="button"
              className="canvases__action"
              title="Delete project"
              onClick={() => removeProject(project)}
            >
              {TrashIcon}
            </button>
          </div>
          {!collapsed.has(project.id) && (
            <ul className="canvases__list canvases__list--nested">
              {canvasesIn(project.id).map(renderCanvas)}
            </ul>
          )}
        </div>
      ))}
      <ul className="canvases__list">{canvasesIn().map(renderCanvas)}</ul>
    </div>
  );
};
