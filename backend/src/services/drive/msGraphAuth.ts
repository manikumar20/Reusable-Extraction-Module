/** Re-export — use services/onedrive/msGraphAuth.ts as the source of truth. */
export {
  clearMsGraphCredential,
  getGraphToken,
  isMsGraphConfigured,
  requireMsGraphConfig,
} from "../onedrive/msGraphAuth.js";
