/**
 * The field catalog: key, data type, and description.
 * Leave src/extraction/shared/prompt.ts unchanged.
 *
 * The eight default line fields stay mapped to fixed tool properties.
 * Do not rename those tool properties; the prompt talks about them by name.
 *
 *   line_no                  → customerItemNumber
 *   short_description        → description
 *   product_name             → productName
 *   manufacturers            → manufacturers, plus manufacturer and partNumber
 *   quantity                 → quantity
 *   uom                      → unitOfMeasure
 *   currency                 → currency
 *   technical_specification  → technicalSpecification
 *
 * Every other LINE key is an extraFields property. Its description is what
 * Claude reads for that field. A template in the calling app does not add a
 * field to the Claude call. To make extraction see a new field, add it here.
 */

import {
  FIELD_DATA_TYPES,
  ITEM_SCOPES,
  type FieldDataType,
} from "./constants.js";

export { FIELD_DATA_TYPES, ITEM_SCOPES };
export type { FieldDataType };

export type CatalogField = {
  key: string;
  label: string;
  dataType: FieldDataType;
  description: string;
  isDefault?: boolean;
  matchRole?: string;
  /** False for customer-identifying fields; they never go to suppliers. */
  supplierShareable?: boolean;
  /** How matching uses the value; kept in step with the matching services. */
  matchingUse?: string;
};

const { TEXT, NUMBER, DATE, CODE, ENUM, LIST, KEY_VALUE, MANUFACTURER_LIST } =
  FIELD_DATA_TYPES;

const PRODUCT_MATCHING = "Product matching: helps pick the right catalogue product.";

export const LINE_FIELDS: CatalogField[] = [
  // The 8 default fields every template keeps (they have their own columns).
  {
    key: "invoice_number",
    label: "Invoice Number",
    dataType: TEXT,
    isDefault: true,
    description: "The unique invoice reference number printed on the document."
  },
  {
    key: "invoice_date",
    label: "Invoice Date",
    dataType: DATE,
    isDefault: true,
    description: "The date on which the invoice was issued."
  },
  {
    key: "vendor_name",
    label: "Vendor Name",
    dataType: TEXT,
    isDefault: true,
    matchRole: "IDENTIFIER",
    description: "The official name of the company or supplier issuing the invoice."
  },
  {
    key: "billing_address",
    label: "Billing Address",
    dataType: TEXT,
    isDefault: true,
    description: "The complete billing address of the customer mentioned in the document."
  },
  {
    key: "subtotal",
    label: "Subtotal",
    dataType: NUMBER,
    isDefault: true,
    description: "The total amount before taxes, discounts and additional charges."
  },
  {
    key: "tax_amount",
    label: "Tax Amount",
    dataType: NUMBER,
    isDefault: true,
    description: "The total tax amount applied to the invoice, including applicable GST or VAT."
  },
  {
    key: "discount_percentage",
    label: "Discount Percentage",
    dataType: NUMBER,
    isDefault: true,
    description: "The discount percentage applied to the invoice or individual product."
  },
  {
    key: "total_amount",
    label: "Total Amount",
    dataType: NUMBER,
    isDefault: true,
    description: "The final payable amount after taxes, discounts and additional charges."
  },
  {
    key: "payment_status",
    label: "Payment Status",
    dataType: CODE,
    isDefault: true,
    description: "The payment status such as PAID, UNPAID or PARTIALLY_PAID."
  },
  {
    key: "payment_terms",
    label: "Payment Terms",
    dataType: TEXT,
    isDefault: true,
    description: "The agreed payment conditions such as Net 30, Net 60 or Advance Payment."
  },
  {
    key: "purchase_order_number",
    label: "Purchase Order Number",
    dataType: TEXT,
    isDefault: true,
    description: "The purchase order reference number associated with the invoice."
  },
  {
    key: "due_date",
    label: "Due Date",
    dataType: DATE,
    isDefault: true,
    description: "The final date by which the invoice payment must be completed."
  },
  // Optional fields, stored in extraFields.
  { key: "item_scope", label: "Item Scope", dataType: ENUM, matchRole: "SCOPE", matchingUse: "Supplier matching: spare-part lines go to the equipment maker's spares suppliers. Also helps product matching.", description: "FULL when the line buys a complete product in its own right (valve, fitting, pipe, tube, cable, instrument, consumable), even a small one. PARTIAL for an assembly or kit of a larger unit (repair kit, actuator assembly, stem and piston assembly). PART for a spare component of a specific larger unit (seat ring, O-ring, diaphragm, PCB board), usually with equipment, OEM model or drawing references." },
  { key: "long_description", label: "Long Description", dataType: TEXT, matchRole: "DESCRIPTIVE", description: "The full item text (Basic Data Text, Purchase Order Text, PO Material Text or InternalNote), without page headers." },
  { key: "material_code", label: "Customer Material Code", dataType: TEXT, matchRole: "CUSTOMER_CODE", supplierShareable: false, matchingUse: "Product matching: remembers the product confirmed for this customer's code.", description: "The customer's stock or material number (Material Number, Mat'l code, ITEM CODE, Vocab). In SAP printouts it is the long number right after the item number on the item row, e.g. 00010 120005020889." },
  { key: "old_material_code", label: "Old Material Code", dataType: TEXT, matchRole: "CUSTOMER_CODE", supplierShareable: false, matchingUse: "Product matching: remembers the product confirmed for this customer's code.", description: "The customer's legacy material number (Old Material Number)." },
  { key: "manufacturer_number", label: "Manufacturer Number", dataType: LIST, matchRole: "CUSTOMER_CODE", supplierShareable: false, description: "The customer's own code for each maker, printed in MPN Text as Manufacturer number, e.g. 'Manufacturer number :0020000929 -L&T VALVES LIMITED' -> 0020000929. The number only; the maker name and its part number go to manufacturers. Not the Manufacturer Part Number." },
  { key: "impa_code", label: "IMPA Code", dataType: TEXT, matchRole: "IDENTIFIER", matchingUse: PRODUCT_MATCHING, description: "The IMPA marine stores catalogue code, usually 6 digits, e.g. 'IMPA CODE: 750203' -> 750203." },
  { key: "material_class", label: "Material Class", dataType: TEXT, matchRole: "CATEGORY", matchingUse: "Supplier matching: finds suppliers in this category. Also helps product matching.", description: "The item's classification class, e.g. VALVE,GATE or GASKET." },
  { key: "specifications", label: "Specifications", dataType: KEY_VALUE, matchRole: "DESCRIPTIVE", matchingUse: PRODUCT_MATCHING, description: "Characteristic name/value pairs such as NOMINAL SIZE, PRESSURE RATING or BODY MATERIAL. Skip --- placeholders." },
  { key: "standards_compliance", label: "Standards / Compliance", dataType: LIST, matchRole: "DESCRIPTIVE", matchingUse: PRODUCT_MATCHING, description: "Standards the item must meet, e.g. NACE MR0175, ASME B16.5, API 607 or DIN 50049." },
  { key: "oem_part_number", label: "OEM Part Number", dataType: TEXT, matchRole: "IDENTIFIER", description: "The original equipment manufacturer's part number, when it is printed separately from the manufacturer part number." },
  { key: "oem_model_number", label: "OEM Model Number", dataType: TEXT, matchRole: "MODEL", matchingUse: PRODUCT_MATCHING, description: "The model of the unit or of its parent equipment (OEM Model Number, MODEL)." },
  { key: "oem_serial_number", label: "OEM Serial Number", dataType: TEXT, matchRole: "REPEAT_KEY", description: "The serial number of the unit or of its parent equipment (OEM Serial Number, Sr. No)." },
  { key: "equipment_name", label: "Equipment Name", dataType: TEXT, matchRole: "DESCRIPTIVE", matchingUse: PRODUCT_MATCHING, description: "The equipment the item belongs to (EQUIPMENT NAME, EQPT NAME, EQUIPMENT TYPE), e.g. TURBINE." },
  { key: "equipment_manufacturer", label: "Equipment Manufacturer", dataType: TEXT, matchRole: "PARENT_OEM", matchingUse: "Supplier matching: on spare-part lines, finds this maker's spares suppliers. Also helps product matching.", description: "For spares, the maker of the parent equipment (EQPT MAKER, COMP MAKER, MFR.), e.g. GE SENSING (PANAMETRICS)." },
  { key: "drawing_number", label: "Drawing Number", dataType: TEXT, description: "The drawing or DWG number that shows the item." },
  { key: "position_number", label: "Position Number", dataType: TEXT, description: "The item's position or balloon number on the drawing; it may be a list such as 4,9,14." },
  { key: "tag_number", label: "Tag Number", dataType: TEXT, matchRole: "REPEAT_KEY", description: "The plant equipment tag (Tag Number, TAG NO., EQUIPMENT TAG NO), e.g. 0751-FV-1009." },
  { key: "spir_number", label: "SPIR Number", dataType: TEXT, matchRole: "REPEAT_KEY", description: "The Spare Parts Interchangeability Record reference (SPIR NO.), e.g. 5228-088." },
  { key: "previous_po_reference", label: "Previous PO Reference", dataType: TEXT, matchRole: "REPEAT_KEY", description: "An earlier purchase order for the same item (PO REF, OLD PO REF, ORDER NO)." },
  { key: "requested_delivery_date", label: "Requested Delivery Date", dataType: DATE, description: "The delivery date requested for this line. It may be earlier than the document date." },
  { key: "ship_to", label: "Ship To", dataType: TEXT, matchRole: "LOCATION", supplierShareable: false, description: "The delivery point for this line (Ship To, Plant / Storage Location)." },
  { key: "inspection_requirements", label: "Inspection Requirements", dataType: TEXT, description: "Inspection and certification requirements (Inspection Text, EN 10204 3.1, Certificate of Conformity, TPI)." },
  { key: "acceptable_brands", label: "Acceptable Brands", dataType: LIST, matchRole: "BRAND_FILTER", description: "The brands or makes the customer will accept, e.g. ANY ADNOC APPROVED VENDOR or MAKE: RECTRON OR EQUIVALENT." },
  { key: "reference_documents", label: "Reference Documents", dataType: LIST, description: "Datasheets, valve lists or other documents the line refers to, e.g. DATA SHEET 2820-L-DS-0014." },
];

export const HEADER_FIELDS: CatalogField[] = [
  { key: "document_number", label: "Document No.", dataType: TEXT, supplierShareable: false, description: "Customer document / RFx / enquiry number (Document Number, RFx Number, NPCC Enquiry No.). If the document does not print it, take it from the file name or an attachment name such as enquiry_6000142038_technical_bid_submission_sheet.xls." },
  { key: "pr_number", label: "PR / Requisition No.", dataType: TEXT, supplierShareable: false, description: "Purchase requisition number (REQ No, Requisition Number, PR in the file name)." },
  { key: "customer_name", label: "Customer", dataType: TEXT, supplierShareable: false, description: 'Company issuing the document (page header, "This RFP is published by ..."). Never our own company shown as the supplier or vendor.' },
  { key: "document_title", label: "Document Title", dataType: TEXT, description: "Short subject of the document (REQ TITLE, Material :, Title:)." },
  { key: "event_type", label: "Event Type", dataType: CODE, description: "The printed event type, such as RFP, RFI, EOI or ENQUIRY." },
  { key: "buyer_name", label: "Buyer", dataType: TEXT, supplierShareable: false, description: "Customer buyer or owner name (Owner, Buyer Details, BUYER)." },
  { key: "buyer_email", label: "Buyer Email", dataType: TEXT, supplierShareable: false, description: "Customer buyer email address." },
  { key: "issue_date", label: "Issue Date", dataType: DATE, supplierShareable: false, description: "Date the document was issued (DATE:, Publish time). Not the file download time." },
  { key: "closing_datetime", label: "Closing Date / Time", dataType: TEXT, supplierShareable: false, description: "Bid due date and time (Due date, CLOSING DATE + CLOSING TIME, DEADLINE). Write YYYY-MM-DD HH:MM when unambiguous, otherwise as printed. Ignore 1/1/1900." },
  { key: "document_currency", label: "Currency", dataType: CODE, description: "3-letter ISO currency of the document (US Dollar -> USD, UAE Dirham -> AED)." },
  { key: "incoterm", label: "Incoterm", dataType: CODE, matchRole: "LOCATION", description: "Delivery term code such as DAP, DDU, DDP, EXW (Inco Term, DELIVERY TERMS)." },
  { key: "delivery_location", label: "Delivery Location", dataType: TEXT, matchRole: "LOCATION", supplierShareable: false, description: "Where goods must be delivered (Inco Term Location, SHIP TO, DEL. SITE)." },
  { key: "special_instructions", label: "Special Instructions", dataType: TEXT, supplierShareable: false, description: "Special instructions or conditions for bidders, summarised in at most three sentences." },
  { key: "bid_validity", label: "Bid Validity", dataType: TEXT, description: "Required quote validity, e.g. 90 days (Bid Validity, VALIDITY END). Empty when it is a blank field for the bidder." },
  { key: "payment_terms", label: "Payment Terms", dataType: TEXT, description: "Payment terms set by the customer, e.g. 30 days net. Empty when it is a blank field for the bidder." },
  { key: "project_reference", label: "Project", dataType: TEXT, supplierShareable: false, description: "Project name or code (Project, PROJECT:)." },
  { key: "external_reference", label: "External Reference", dataType: TEXT, supplierShareable: false, description: "End customer document number on a re-enquiry from a trader (EXT REF)." },
];

/** Optional line keys. These are the extraFields Claude fills on every call. */
export const OPTIONAL_LINE_FIELDS = LINE_FIELDS.filter((field) => !field.isDefault);
