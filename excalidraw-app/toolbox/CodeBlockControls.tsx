import {
  arrayToMap,
  sceneCoordsToViewportCoords,
  viewportCoordsToSceneCoords,
} from "@excalidraw/common";
import { useExcalidrawAPI } from "@excalidraw/excalidraw";
import { copyTextToSystemClipboard } from "@excalidraw/excalidraw/clipboard";
import DropdownMenu from "@excalidraw/excalidraw/components/dropdownMenu/DropdownMenu";
import {
  checkIcon,
  chevronDownIcon,
  copyIcon,
} from "@excalidraw/excalidraw/components/icons";
import { useCopyStatus } from "@excalidraw/excalidraw/hooks/useCopiedIndicator";
import { t } from "@excalidraw/excalidraw/i18n";
import {
  CODE_LANGUAGES,
  CaptureUpdateAction,
  getBoundTextElement,
  hitElementBoundingBox,
  isCodeElement,
  newElementWith,
} from "@excalidraw/element";
import { pointFrom, pointRotateRads } from "@excalidraw/math";
import { useEffect, useRef, useState } from "react";

import type { GlobalPoint } from "@excalidraw/math";

/** from the block's top right corner */
const INSET = 6;

/**
 * A code block's language and copy button, while the pointer is on it (on
 * phones, once tapped)
 */
export const CodeBlockControls = () => {
  const api = useExcalidrawAPI();
  const ref = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const { copyStatus, onCopy } = useCopyStatus();
  const [block, setBlock] = useState<{
    id: string;
    language: string;
    text: string;
    left: number;
    top: number;
  } | null>(null);

  useEffect(() => {
    // it stays while open, its options reaching past the block
    if (!api || open) {
      return;
    }
    let pointer: PointerEvent | null = null;

    const update = () => {
      if (!pointer || ref.current?.contains(pointer.target as Node)) {
        return;
      }
      const appState = api.getAppState();
      const target = pointer.target as HTMLElement;
      const isIdle =
        (target instanceof HTMLCanvasElement ||
          target.dataset.type === "wysiwyg") &&
        !pointer.buttons &&
        !appState.viewModeEnabled &&
        (appState.activeTool.type === "selection" ||
          appState.activeTool.type === "lasso");
      const { x, y } = viewportCoordsToSceneCoords(pointer, appState);
      const elements = api.getSceneElements();
      const elementsMap = arrayToMap(elements);
      const hovered = isIdle
        ? elements.findLast(
            (el) =>
              isCodeElement(el) &&
              hitElementBoundingBox(
                pointFrom<GlobalPoint>(x, y),
                el,
                elementsMap,
              ),
          )
        : undefined;
      if (!hovered) {
        setBlock(null);
        return;
      }
      const [sceneX, sceneY] = pointRotateRads(
        pointFrom<GlobalPoint>(
          hovered.x + hovered.width - INSET,
          hovered.y + INSET,
        ),
        pointFrom<GlobalPoint>(
          hovered.x + hovered.width / 2,
          hovered.y + hovered.height / 2,
        ),
        hovered.angle,
      );
      const { x: left, y: top } = sceneCoordsToViewportCoords(
        { sceneX, sceneY },
        appState,
      );
      setBlock({
        id: hovered.id,
        language: hovered.customData?.code.language,
        text: getBoundTextElement(hovered, elementsMap)?.originalText ?? "",
        // on screen even when the block's corner isn't
        left: Math.min(left, appState.offsetLeft + appState.width - INSET),
        top: Math.max(top, appState.offsetTop + INSET),
      });
    };

    const onPointer = (event: PointerEvent) => {
      pointer = event;
      update();
    };
    window.addEventListener("pointermove", onPointer);
    window.addEventListener("pointerup", onPointer);
    // the canvas can pan and zoom under a still pointer
    const offChange = api.onChange(update);
    return () => {
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("pointerup", onPointer);
      offChange();
    };
  }, [api, open]);

  if (!api || !block) {
    return null;
  }

  return (
    <div
      ref={ref}
      className="code-block-controls"
      style={{ left: block.left, top: block.top }}
      // the caret stays in the block being edited
      onMouseDown={(event) => event.preventDefault()}
    >
      <DropdownMenu open={open}>
        <DropdownMenu.Trigger onToggle={() => setOpen(!open)}>
          {CODE_LANGUAGES[block.language]}
          {chevronDownIcon}
        </DropdownMenu.Trigger>
        <DropdownMenu.Content
          onClickOutside={() => setOpen(false)}
          onSelect={() => setOpen(false)}
        >
          {Object.entries(CODE_LANGUAGES).map(([language, name]) => (
            <DropdownMenu.Item
              key={language}
              selected={language === block.language}
              onSelect={() => {
                api.updateScene({
                  elements: api.getSceneElementsIncludingDeleted().map((el) =>
                    el.id === block.id
                      ? newElementWith(el, {
                          customData: { ...el.customData, code: { language } },
                        })
                      : el,
                  ),
                  captureUpdate: CaptureUpdateAction.IMMEDIATELY,
                });
                setBlock({ ...block, language });
              }}
            >
              {name}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu>
      <button
        type="button"
        className="dropdown-menu-button"
        title={t("labels.copy")}
        onClick={async () => {
          try {
            await copyTextToSystemClipboard(block.text);
            onCopy();
          } catch {
            api.setToast({ message: t("errors.copyToSystemClipboardFailed") });
          }
        }}
      >
        {copyStatus ? checkIcon : copyIcon}
      </button>
    </div>
  );
};
