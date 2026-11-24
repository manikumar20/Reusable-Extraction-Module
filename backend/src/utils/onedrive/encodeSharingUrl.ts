/** Encode a sharing URL for Microsoft Graph /shares/{shareId}. */
export const encodeSharingUrl = (sharingUrl: string) => {
  const base64 = Buffer.from(sharingUrl, "utf8")
    .toString("base64")
    .replace(/=+$/g, "")
    .replace(/\//g, "_")
    .replace(/\+/g, "-");
  return `u!${base64}`;
};
