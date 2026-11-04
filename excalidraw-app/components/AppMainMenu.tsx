import {
  createIcon,
  eyeIcon,
  LoadIcon,
} from "@excalidraw/excalidraw/components/icons";
import { MainMenu } from "@excalidraw/excalidraw/index";
import { useExcalidrawAPI } from "@excalidraw/excalidraw";
import React from "react";

import { DEFAULT_SIDEBAR, isDevEnv } from "@excalidraw/common";

import type { Theme } from "@excalidraw/element/types";

import { LanguageList } from "../app-language/LanguageList";
import { goToCanvas, signOut } from "../data/canvases";
import { LocalData } from "../data/LocalData";

import { saveDebugState } from "./DebugCanvas";

const signOutIcon = createIcon(
  <path d="M14 8v-2a2 2 0 0 0 -2 -2h-7a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2 -2v-2M9 12h12l-3 -3M18 15l3 -3" />,
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

export const AppMainMenu: React.FC<{
  theme: Theme | "system";
  refresh: () => void;
}> = React.memo((props) => {
  const excalidrawAPI = useExcalidrawAPI();
  return (
    <MainMenu>
      <MainMenu.Item
        icon={LoadIcon}
        onSelect={() =>
          excalidrawAPI?.toggleSidebar({
            name: DEFAULT_SIDEBAR.name,
            tab: "canvases",
            force: true,
          })
        }
      >
        Canvases
      </MainMenu.Item>
      <MainMenu.Item
        onSelect={() => {
          LocalData.flushSave();
          goToCanvas();
        }}
      >
        All canvases
      </MainMenu.Item>
      <MainMenu.DefaultItems.LoadScene />
      <MainMenu.DefaultItems.SaveToActiveFile />
      <MainMenu.DefaultItems.Export />
      <MainMenu.DefaultItems.ClearCanvas />
      <MainMenu.Separator />
      <MainMenu.Item
        icon={signOutIcon}
        onSelect={() => {
          LocalData.flushSave();
          signOut();
        }}
      >
        Sign out
      </MainMenu.Item>
      {isDevEnv() && (
        <MainMenu.Item
          icon={eyeIcon}
          onSelect={() => {
            if (window.visualDebug) {
              delete window.visualDebug;
              saveDebugState({ enabled: false });
            } else {
              window.visualDebug = { data: [] };
              saveDebugState({ enabled: true });
            }
            props?.refresh();
          }}
        >
          Visual Debug
        </MainMenu.Item>
      )}
      <MainMenu.Separator />
      <MainMenu.DefaultItems.Preferences />
      <MainMenu.DefaultItems.ToggleTheme allowSystemTheme theme={props.theme} />
      <MainMenu.ItemCustom>
        <LanguageList style={{ width: "100%" }} />
      </MainMenu.ItemCustom>
      <MainMenu.DefaultItems.ChangeCanvasBackground />
    </MainMenu>
  );
});
