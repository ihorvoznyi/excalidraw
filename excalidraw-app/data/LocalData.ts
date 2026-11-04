/**
 * This file deals with saving data state (appState, elements, images, ...)
 * of the open canvas to the cloud (see `./canvases.ts`).
 *
 * Notes:
 *
 * - DataState refers to full state of the app: appState, elements, images,
 *   though some state is saved separately (collab username, library) for one
 *   reason or another, and stays in the browser (localStorage, indexedDB).
 */

import { debounce } from "@excalidraw/common";
import { createStore, get, set } from "idb-keyval";

import type { LibraryPersistedData } from "@excalidraw/excalidraw/data/library";
import type { ImportedDataState } from "@excalidraw/excalidraw/data/types";
import type { ExcalidrawElement, FileId } from "@excalidraw/element/types";
import type {
  AppState,
  BinaryFileData,
  BinaryFiles,
} from "@excalidraw/excalidraw/types";
import type { MaybePromise } from "@excalidraw/common/utility-types";

import { appJotaiStore } from "../app-jotai";
import { SAVE_TO_LOCAL_STORAGE_TIMEOUT, STORAGE_KEYS } from "../app_constants";

import { canvasFilePath, currentCanvasIdAtom, saveCanvas } from "./canvases";
import { FileManager } from "./FileManager";
import { FileStatusStore } from "./fileStatusStore";
import { downloadBytesFromFirebase, uploadBytesToFirebase } from "./firebase";
import { Locker } from "./Locker";

// images saved before canvases moved to the cloud
const filesStore = createStore("files-db", "files-store");

const uploadFile = (fileData: BinaryFileData) =>
  uploadBytesToFirebase(
    canvasFilePath(fileData.id),
    new TextEncoder().encode(JSON.stringify(fileData)),
  );

type SavingLockTypes = "collaboration";

export class LocalData {
  private static _save = debounce(
    async (
      canvasId: string,
      elements: readonly ExcalidrawElement[],
      appState: AppState,
      files: BinaryFiles,
      onFilesSaved: () => void,
    ) => {
      saveCanvas(canvasId, elements, appState).catch(console.error);

      await this.fileStorage.saveFiles({
        elements,
        files,
      });
      onFilesSaved();
    },
    SAVE_TO_LOCAL_STORAGE_TIMEOUT,
  );

  /** Saves DataState, including files. Bails if saving is paused */
  static save = (
    elements: readonly ExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles,
    onFilesSaved: () => void,
  ) => {
    // we need to make the `isSavePaused` check synchronously (undebounced),
    // and pin the canvas the elements belong to before it can change
    const canvasId = appJotaiStore.get(currentCanvasIdAtom);
    if (!this.isSavePaused() && canvasId && !appState.isLoading) {
      this._save(canvasId, elements, appState, files, onFilesSaved);
    }
  };

  static flushSave = () => {
    this._save.flush();
  };

  private static locker = new Locker<SavingLockTypes>();

  static pauseSave = (lockType: SavingLockTypes) => {
    this.locker.lock(lockType);
  };

  static resumeSave = (lockType: SavingLockTypes) => {
    this.locker.unlock(lockType);
  };

  static isSavePaused = () => {
    return document.hidden || this.locker.isLocked();
  };

  // ---------------------------------------------------------------------------

  static fileStorage = new FileManager({
    onFileStatusChange: FileStatusStore.updateStatuses.bind(FileStatusStore),
    async getFiles(ids) {
      const loadedFiles: BinaryFileData[] = [];
      const erroredFiles = new Map<FileId, true>();

      await Promise.all(
        ids.map(async (id) => {
          try {
            const bytes = await downloadBytesFromFirebase(canvasFilePath(id));
            loadedFiles.push(JSON.parse(new TextDecoder().decode(bytes)));
          } catch (error: any) {
            const fileData = await get<BinaryFileData>(id, filesStore);
            if (fileData) {
              loadedFiles.push(fileData);
              uploadFile(fileData).catch(console.error);
            } else {
              console.error(error);
              erroredFiles.set(id, true);
            }
          }
        }),
      );

      return { loadedFiles, erroredFiles };
    },
    async saveFiles({ addedFiles }) {
      const savedFiles = new Map<FileId, BinaryFileData>();
      const erroredFiles = new Map<FileId, BinaryFileData>();

      await Promise.all(
        [...addedFiles].map(async ([id, fileData]) => {
          try {
            await uploadFile(fileData);
            savedFiles.set(id, fileData);
          } catch (error: any) {
            console.error(error);
            erroredFiles.set(id, fileData);
          }
        }),
      );

      return { savedFiles, erroredFiles };
    },
  });
}
export class LibraryIndexedDBAdapter {
  /** IndexedDB database and store name */
  private static idb_name = STORAGE_KEYS.IDB_LIBRARY;
  /** library data store key */
  private static key = "libraryData";

  private static store = createStore(
    `${LibraryIndexedDBAdapter.idb_name}-db`,
    `${LibraryIndexedDBAdapter.idb_name}-store`,
  );

  static async load() {
    const IDBData = await get<LibraryPersistedData>(
      LibraryIndexedDBAdapter.key,
      LibraryIndexedDBAdapter.store,
    );

    return IDBData || null;
  }

  static save(data: LibraryPersistedData): MaybePromise<void> {
    return set(
      LibraryIndexedDBAdapter.key,
      data,
      LibraryIndexedDBAdapter.store,
    );
  }
}

/** LS Adapter used only for migrating LS library data
 * to indexedDB */
export class LibraryLocalStorageMigrationAdapter {
  static load() {
    const LSData = localStorage.getItem(
      STORAGE_KEYS.__LEGACY_LOCAL_STORAGE_LIBRARY,
    );
    if (LSData != null) {
      const libraryItems: ImportedDataState["libraryItems"] =
        JSON.parse(LSData);
      if (libraryItems) {
        return { libraryItems };
      }
    }
    return null;
  }
  static clear() {
    localStorage.removeItem(STORAGE_KEYS.__LEGACY_LOCAL_STORAGE_LIBRARY);
  }
}
