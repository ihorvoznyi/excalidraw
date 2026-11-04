import { THEME } from "@excalidraw/excalidraw";
import { ExcalidrawLogo } from "@excalidraw/excalidraw/components/ExcalidrawLogo";
import clsx from "clsx";

import { signOut } from "../data/canvases";
import { useHandleAppTheme } from "../useHandleAppTheme";

import { Canvases } from "./Canvases";

import "./Home.scss";

export const Home = () => {
  const { editorTheme } = useHandleAppTheme();

  return (
    <div
      className={clsx("excalidraw home", {
        "theme--dark": editorTheme === THEME.DARK,
      })}
    >
      <ExcalidrawLogo withText size="small" />
      <div className="home__list">
        <Canvases />
      </div>
      <button type="button" className="home__sign-out" onClick={signOut}>
        Sign out
      </button>
    </div>
  );
};
