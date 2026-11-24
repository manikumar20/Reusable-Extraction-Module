export type OneDriveListedFile = {
  id: string;
  name: string;
  mimeType: string;
  size: number | null;
  source: "onedrive";
};

export type GraphDriveItem = {
  id?: string;
  name?: string;
  size?: number;
  parentReference?: { driveId?: string };
  file?: { mimeType?: string };
  folder?: { childCount?: number };
  "@microsoft.graph.downloadUrl"?: string;
};

export type GraphDriveItemPage = {
  value?: GraphDriveItem[];
  "@odata.nextLink"?: string;
};
