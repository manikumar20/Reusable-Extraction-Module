import type { StoredDocument } from "./types";

const uploadedAt = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
};

export const DocumentsPanel = ({ documents }: { documents: StoredDocument[] }) =>
  documents.length === 0 ? (
    <p className="hint">No documents saved yet.</p>
  ) : (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>File name</th>
            <th>Uploaded</th>
          </tr>
        </thead>
        <tbody>
          {documents.map((document) => (
            <tr key={document.id}>
              <td>{document.fileName}</td>
              <td>{uploadedAt(document.uploadedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
