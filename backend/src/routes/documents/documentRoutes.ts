import { Router } from "express";
import { handleListDocuments } from "../../controllers/documents/documentController.js";
import { asyncHandler } from "../../middleware/asyncHandler.js";

export const documentRouter = Router();

documentRouter.get("/", asyncHandler(handleListDocuments));
