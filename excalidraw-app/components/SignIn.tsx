import { THEME } from "@excalidraw/excalidraw";
import { ExcalidrawLogo } from "@excalidraw/excalidraw/components/ExcalidrawLogo";
import { FilledButton } from "@excalidraw/excalidraw/components/FilledButton";
import clsx from "clsx";
import { useState } from "react";

import { signIn } from "../data/canvases";
import { useHandleAppTheme } from "../useHandleAppTheme";

import "./SignIn.scss";

export const SignIn = () => {
  const { editorTheme } = useHandleAppTheme();
  const [error, setError] = useState("");

  return (
    <div
      className={clsx("excalidraw sign-in", {
        "theme--dark": editorTheme === THEME.DARK,
      })}
    >
      <ExcalidrawLogo withText size="small" />
      <FilledButton
        size="large"
        label="Sign in with Google"
        onClick={() => signIn().catch((error) => setError(error.message))}
      >
        Sign in with Google
      </FilledButton>
      {error && <div className="sign-in__error">{error}</div>}
    </div>
  );
};
