/**
 * Signed-in user's canvases, stored in Firebase:
 *
 * - users/{uid}/canvases/{id}  { name, updatedAt } (the list)
 * - users/{uid}/scenes/{id}    { data } (gzipped scene JSON)
 * - users/{uid}/files/{fileId} images (Storage, see `LocalData`)
 */

import { serializeAsJSON } from "@excalidraw/excalidraw/data/json";
import { getNonDeletedElements } from "@excalidraw/element";

import type { ImportedDataState } from "@excalidraw/excalidraw/data/types";
import type { ExcalidrawElement } from "@excalidraw/element/types";
import type { AppState } from "@excalidraw/excalidraw/types";

import { appJotaiStore, atom } from "../app-jotai";

import { loadFirebase } from "./firebase";
import { importFromLocalStorage } from "./localStorage";

import type { User } from "firebase/auth";

export type Canvas = { id: string; name: string; updatedAt: number };

export const currentCanvasIdAtom = atom<string | null>(null);

let uid = "";
const userPath = (...segments: string[]) =>
  ["users", uid, ...segments].join("/");

export const canvasFilePath = (fileId: string) => userPath("files", fileId);

const loadFirestore = async () => {
  const { sdk, app } = await loadFirebase();
  return { sdk, db: sdk.getFirestore(app) };
};

const gzip = async (text: string) =>
  new Uint8Array(
    await new Response(
      new Blob([text]).stream().pipeThrough(new CompressionStream("gzip")),
    ).arrayBuffer(),
  );

const gunzip = (bytes: Uint8Array<ArrayBuffer>) =>
  new Response(
    new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip")),
  ).text();

const encodeScene = async (json: string) => {
  const { sdk } = await loadFirestore();
  return { data: sdk.Bytes.fromUint8Array(await gzip(json)) };
};

// -----------------------------------------------------------------------------

export const onUserChange = async (callback: (user: User | null) => void) => {
  const { sdk, app } = await loadFirebase();
  sdk.onAuthStateChanged(sdk.getAuth(app), (user) => {
    uid = user?.uid ?? "";
    callback(user);
  });
};

export const signIn = async () => {
  const { sdk, app } = await loadFirebase();
  await sdk.signInWithPopup(sdk.getAuth(app), new sdk.GoogleAuthProvider());
};

export const signOut = async () => {
  const { sdk, app } = await loadFirebase();
  await sdk.signOut(sdk.getAuth(app));
};

// -----------------------------------------------------------------------------

export const subscribeToCanvases = (callback: (canvases: Canvas[]) => void) => {
  const unsubscribe = loadFirestore().then(({ sdk, db }) =>
    sdk.onSnapshot(
      sdk.query(
        sdk.collection(db, userPath("canvases")),
        sdk.orderBy("updatedAt", "desc"),
      ),
      (snapshot) =>
        callback(
          snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() } as Canvas)),
        ),
    ),
  );
  return () => {
    unsubscribe.then((unsubscribe) => unsubscribe());
  };
};

export const createCanvas = async (
  elements: readonly ExcalidrawElement[] = [],
  appState: Partial<AppState> = {},
) => {
  const { sdk, db } = await loadFirestore();
  const canvas = sdk.doc(sdk.collection(db, userPath("canvases")));
  const batch = sdk.writeBatch(db);
  batch.set(canvas, { name: "Untitled", updatedAt: Date.now() });
  batch.set(
    sdk.doc(db, userPath("scenes", canvas.id)),
    await encodeScene(serializeAsJSON(elements, appState, {}, "database")),
  );
  await batch.commit();
  return canvas.id;
};

/** opens canvas `id`, else the most recently updated one, else a new one */
export const openCanvas = async (id?: string): Promise<ImportedDataState> => {
  const { sdk, db } = await loadFirestore();
  if (!id) {
    const recent = await sdk.getDocs(
      sdk.query(
        sdk.collection(db, userPath("canvases")),
        sdk.orderBy("updatedAt", "desc"),
        sdk.limit(1),
      ),
    );
    if (recent.empty) {
      // first sign-in: the canvas this browser had becomes the first one
      const { elements, appState } = importFromLocalStorage();
      return openCanvas(await createCanvas(elements, appState ?? {}));
    }
    id = recent.docs[0].id;
  }
  const scene = await sdk.getDoc(sdk.doc(db, userPath("scenes", id)));
  if (!scene.exists()) {
    return openCanvas();
  }
  const data = JSON.parse(
    await gunzip(scene.data().data.toUint8Array() as Uint8Array<ArrayBuffer>),
  );
  appJotaiStore.set(currentCanvasIdAtom, id);
  return data;
};

let lastSaved = "";
let pendingSaves = 0;

export const isSavingCanvas = () => pendingSaves > 0;

export const saveCanvas = async (
  id: string,
  elements: readonly ExcalidrawElement[],
  appState: AppState,
) => {
  const json = serializeAsJSON(
    getNonDeletedElements(elements),
    appState,
    {},
    "database",
  );
  if (id + json === lastSaved) {
    return;
  }
  pendingSaves++;
  try {
    const { sdk, db } = await loadFirestore();
    const batch = sdk.writeBatch(db);
    // `update` fails if the canvas was deleted meanwhile, so it isn't revived
    batch.update(sdk.doc(db, userPath("canvases", id)), {
      updatedAt: Date.now(),
    });
    batch.set(sdk.doc(db, userPath("scenes", id)), await encodeScene(json));
    await batch.commit();
    lastSaved = id + json;
  } finally {
    pendingSaves--;
  }
};

export const renameCanvas = async (id: string, name: string) => {
  const { sdk, db } = await loadFirestore();
  await sdk.updateDoc(sdk.doc(db, userPath("canvases", id)), { name });
};

export const deleteCanvas = async (id: string) => {
  const { sdk, db } = await loadFirestore();
  const batch = sdk.writeBatch(db);
  batch.delete(sdk.doc(db, userPath("canvases", id)));
  batch.delete(sdk.doc(db, userPath("scenes", id)));
  await batch.commit();
};
