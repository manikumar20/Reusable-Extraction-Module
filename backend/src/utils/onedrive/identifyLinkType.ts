const isSharePointHost = (host: string) =>
  host.endsWith(".sharepoint.com") ||
  host.endsWith(".sharepoint.us") ||
  host.endsWith(".sharepoint.de") ||
  host.endsWith(".sharepoint.cn");

export const isOneDriveUrl = (value: string) => {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.replace(/^www\./, "").toLowerCase();
  return host === "1drv.ms" || host === "onedrive.live.com" || isSharePointHost(host);
};

export const identifyLinkType = (url: string): "onedrive" | "unknown" =>
  isOneDriveUrl(url) ? "onedrive" : "unknown";
