import { Router } from "express";
import { listDocuments } from "../../db/documents/documentDb.js";
import { fail } from "../../utils/httpError.js";

export const documentRouter = Router();

documentRouter.get("/", async (_req, res, next) => {
  try {
    const documents = await listDocuments();
    res.json({ documents });
  } catch (error) {
    next(error);
  }
});

documentRouter.use((_req, res) => {
  res.status(404).json(fail(404, "Not found.", "NOT_FOUND"));
});
