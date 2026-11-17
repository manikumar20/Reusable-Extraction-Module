import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../storage");

export const storageRoot = root;
export const compressedDir = path.join(root, "compressed");
export const temporaryDir = path.join(root, "temporary");

export const ensureStorageDirs = async () => {
  await fs.mkdir(compressedDir, { recursive: true });
  await fs.mkdir(temporaryDir, { recursive: true });
};
