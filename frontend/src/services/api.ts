import { env } from "../config/env";

export const apiUrl = (path: string) => `${env.apiUrl}/api${path}`;
