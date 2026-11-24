import { useState } from "react";
import { SchemaFieldBuilder } from "./SchemaFieldBuilder.jsx";

/** 20 sample fields: 14 in_schema + 6 suggested */
export const SAMPLE_SCHEMA_FIELDS = [
  {
    id: "customer",
    name: "Customer",
    description: "Customer or account name on the document header.",
    status: "in_schema",
  },
  {
    id: "document_title",
    name: "Document Title",
    description: "Printed title of the RFQ, invoice, or form.",
    status: "in_schema",
  },
  {
    id: "buyer",
    name: "Buyer",
    description: "Buying organization or purchasing contact.",
    status: "in_schema",
  },
  {
    id: "issue_date",
    name: "Issue Date",
    description: "Date the document was issued or published.",
    status: "in_schema",
  },
  {
    id: "closing_datetime",
    name: "Closing Date / Time",
    description: "Deadline for responses or bid submission.",
    status: "in_schema",
  },
  {
    id: "emd_amount",
    name: "EMD Amount",
    description: "Earnest money deposit required with the bid.",
    status: "in_schema",
  },
  {
    id: "contract_duration",
    name: "Contract Duration",
    description: "Length of the proposed contract or engagement.",
    status: "in_schema",
  },
  {
    id: "document_number",
    name: "Document Number",
    description: "RFQ, PO, or reference number printed on the form.",
    status: "in_schema",
  },
  {
    id: "payment_terms",
    name: "Payment Terms",
    description: "How and when payment is expected.",
    status: "in_schema",
  },
  {
    id: "delivery_terms",
    name: "Delivery Terms",
    description: "Incoterms or delivery location and conditions.",
    status: "in_schema",
  },
  {
    id: "currency",
    name: "Currency",
    description: "Currency used for prices and totals.",
    status: "in_schema",
  },
  {
    id: "vendor_name",
    name: "Vendor Name",
    description: "Supplier or bidder named on the document.",
    status: "in_schema",
  },
  {
    id: "special_instructions",
    name: "Special Instructions",
    description: "Notes or conditions that apply to the whole document.",
    status: "in_schema",
  },
  {
    id: "line_description",
    name: "Line Description",
    description: "Item or service description on each table row.",
    status: "in_schema",
  },
  {
    id: "pr_number",
    name: "PR Number",
    description: "Purchase requisition number linked to this request.",
    status: "suggested",
  },
  {
    id: "event_type",
    name: "Event Type",
    description: "Type of sourcing event such as RFQ or auction.",
    status: "suggested",
  },
  {
    id: "qty",
    name: "Quantity",
    description: "Ordered or requested quantity per line item.",
    status: "suggested",
  },
  {
    id: "uom",
    name: "Unit of Measure",
    description: "Unit for quantity such as EA, KG, or SET.",
    status: "suggested",
  },
  {
    id: "unit_price",
    name: "Unit Price",
    description: "Price per unit printed on the line item.",
    status: "suggested",
  },
  {
    id: "tax_amount",
    name: "Tax Amount",
    description: "Tax applied to the document or line total.",
    status: "suggested",
  },
];

/**
 * Demo page wiring local state to SchemaFieldBuilder callbacks.
 * Import this route or render `<SchemaFieldBuilderDemo />` while developing.
 */
export function SchemaFieldBuilderDemo() {
  const [fields, setFields] = useState(SAMPLE_SCHEMA_FIELDS);

  return (
    <div className="min-h-screen bg-slate-100 p-4 sm:p-8 dark:bg-slate-950">
      <SchemaFieldBuilder
        fileName="sample-invoice.pdf"
        fields={fields}
        onAdd={(id) => {
          setFields((current) =>
            current.map((field) =>
              field.id === id ? { ...field, status: "in_schema" } : field,
            ),
          );
        }}
        onAddAll={(ids) => {
          const selected = new Set(ids);
          setFields((current) =>
            current.map((field) =>
              selected.has(field.id) ? { ...field, status: "in_schema" } : field,
            ),
          );
        }}
        onRemove={(id) => {
          setFields((current) => current.filter((field) => field.id !== id));
        }}
        onCreate={(name) => {
          setFields((current) => [
            ...current,
            {
              id: crypto.randomUUID(),
              name,
              description: "Custom field you added.",
              status: "in_schema",
            },
          ]);
        }}
      />
    </div>
  );
}

export default SchemaFieldBuilderDemo;
