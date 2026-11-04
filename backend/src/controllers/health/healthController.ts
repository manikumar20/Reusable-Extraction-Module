import type { Request, Response } from "express";
import { getHealthStatus } from "../../services/health/healthService.js";

export const handleGetHealthStatus = async (_request: Request, response: Response) => {
  response.json(await getHealthStatus());
};
