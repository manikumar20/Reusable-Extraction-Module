import type { Catalog, CatalogField } from "./types";

type TemplatePageProps = {
  catalog: Catalog | null;
};

export const TemplatePage = ({ catalog }: TemplatePageProps) => {
  if (!catalog) {
    return (
      <section className="sheet empty">
        <p className="kicker">Template</p>
        <h2>Field list is still loading</h2>
        <p>Header and line fields appear here once the extraction service answers.</p>
      </section>
    );
  }

  const lineDefaults = catalog.lines.filter((field) => field.isDefault);
  const lineOptional = catalog.lines.filter((field) => !field.isDefault);

  return (
    <div className="template">
      <header className="page-intro">
        <p className="kicker">Template</p>
        <h2>Fields a document fills</h2>
        <p>
          These fields are read from the field catalog. Edit{" "}
          <code>fields.ts</code> and this page shows the change.
        </p>
      </header>
      <FieldTable title="Document header" fields={catalog.header} />
      <FieldTable title="Line items" fields={lineDefaults} />
      <FieldTable title="Optional line fields" fields={lineOptional} />
    </div>
  );
};

const FieldTable = ({
  title,
  fields,
}: {
  title: string;
  fields: CatalogField[];
}) => (
  <section className="sheet template-sheet">
    <div className="block-head">
      <h3>
        {title} <span>{fields.length}</span>
      </h3>
    </div>
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Field</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((field) => (
            <tr key={field.key}>
              <td className="desc">{field.label}</td>
              <td className="desc">{field.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </section>
);
