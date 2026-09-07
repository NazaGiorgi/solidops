import PDFDocument from 'pdfkit';

const BRAND = '#c4027b';
const GRAY = '#555555';
const LIGHT = '#999999';

export interface ReceiptCustomer {
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
}

export interface ReceiptEquipmentData {
  typeLabel: string;
  otherType?: string | null;
  brand?: string | null;
  model?: string | null;
  serialNumber?: string | null;
  accessories?: string | null;
  physicalCondition?: string | null;
  reportedFault: string;
  ticketNumber: string;
  receivedAt: Date;
}

// Cabecera de marca con texto (el logo SVG del proyecto no tiene sus definiciones
// de clase st0/st2, así que se usa una cabecera tipográfica SolidoCS). Pokémon:
// se puede reemplazar por imagen PNG del logo cuando exista una versión limpia.
function header(doc: PDFKit.PDFDocument, docTitle: string, docNumber: string) {
  doc.fillColor(BRAND).fontSize(26).font('Helvetica-Bold').text('SolidoCS', { continued: false });
  doc.fillColor(GRAY).fontSize(10).font('Helvetica').text('Servicios de Informática · Taller de reparación');
  doc
    .fillColor(LIGHT)
    .fontSize(9)
    .font('Helvetica')
    .text(`SolidOps · ${docTitle} N.º ${docNumber}`, { align: 'right' });
  // Línea separadora de marca.
  doc.moveDown(0.4);
  doc.moveTo(40, doc.y).lineTo(doc.page.width - 40, doc.y).strokeColor(BRAND).lineWidth(1.5).stroke();
  doc.moveDown(0.6);
}

function labelValue(doc: PDFKit.PDFDocument, label: string, value: string | null | undefined) {
  const v = (value || '').toString().trim();
  if (!v) return;
  doc.fillColor(GRAY).font('Helvetica-Bold').fontSize(10).text(`${label}: `, { continued: true });
  doc.fillColor('#111111').font('Helvetica').fontSize(10).text(v || '—');
}

function sectionTitle(doc: PDFKit.PDFDocument, title: string) {
  doc.moveDown(0.4);
  doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(12).text(title);
  doc.moveDown(0.2);
}

const MONEY = (n: string | number) =>
  new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS' }).format(Number(n));

export function buildReceptionPdf(data: {
  customer: ReceiptCustomer;
  equipment: ReceiptEquipmentData;
}): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  return new Promise<Buffer>((resolve) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    header(doc, 'Comprobante de recepción', data.equipment.ticketNumber);

  sectionTitle(doc, 'Cliente');
  labelValue(doc, 'Nombre', data.customer.name);
  labelValue(doc, 'Teléfono', data.customer.phone);
  labelValue(doc, 'Email', data.customer.email);
  labelValue(doc, 'Domicilio', data.customer.address);

  sectionTitle(doc, 'Equipo recibido');
  labelValue(doc, 'Tipo', `${data.equipment.typeLabel}${data.equipment.otherType ? ' (' + data.equipment.otherType + ')' : ''}`);
  labelValue(doc, 'Marca', data.equipment.brand);
  labelValue(doc, 'Modelo', data.equipment.model);
  labelValue(doc, 'N.º de serie', data.equipment.serialNumber);
  labelValue(doc, 'Accesorios recibidos', data.equipment.accessories);
  labelValue(doc, 'Estado físico', data.equipment.physicalCondition);

  sectionTitle(doc, 'Falla reportada');
  doc.fillColor('#111111').font('Helvetica').fontSize(10).text(data.equipment.reportedFault || '—');

  sectionTitle(doc, 'Fecha de ingreso');
  labelValue(doc, 'Ingreso', data.equipment.receivedAt.toLocaleString('es-AR'));

  doc.moveDown(2);
  doc
    .fillColor(GRAY)
    .font('Helvetica')
    .fontSize(8)
    .text(
      'Este comprobante acredita la recepción del equipo en el taller de SolidoCS. ' +
        'Conserve este número para retirar su equipo. Los repuestos y el diagnóstico ' +
        'requieren presupuesto aprobado antes de proceder con la reparación.',
      { align: 'justify' },
    );

  doc.end();
  });
}

export interface QuotePdfData {
  customer: ReceiptCustomer;
  equipment: {
    typeLabel: string;
    brand?: string | null;
    model?: string | null;
    serialNumber?: string | null;
  };
  quoteNumber: string;
  notes?: string | null;
  lines: Array<{ name: string; isLabor: boolean; quantity: number; unitPrice: string; lineTotal: string }>;
  subtotal: string;
  total: string;
  issuedAt: Date;
}

export function buildQuotePdf(data: QuotePdfData): Promise<Buffer> {
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  return new Promise<Buffer>((resolve) => {
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    header(doc, 'Presupuesto', data.quoteNumber);

  sectionTitle(doc, 'Cliente');
  labelValue(doc, 'Nombre', data.customer.name);
  labelValue(doc, 'Telefono', data.customer.phone);
  labelValue(doc, 'Email', data.customer.email);

  sectionTitle(doc, 'Equipo');
  labelValue(doc, 'Tipo', data.equipment.typeLabel);
  labelValue(doc, 'Marca', data.equipment.brand);
  labelValue(doc, 'Modelo', data.equipment.model);
  labelValue(doc, 'N.º de serie', data.equipment.serialNumber);

  if (data.notes) {
    sectionTitle(doc, 'Descripción del trabajo');
    doc.fillColor('#111111').font('Helvetica').fontSize(10).text(data.notes);
  }

  sectionTitle(doc, 'Detalle');
  // Tabla de líneas.
  const right = doc.page.width - 40;
  const lineY = doc.y;
  doc.fillColor('#111111').font('Helvetica-Bold').fontSize(9);
  // Cabecera de columnas.
  const cols = { desc: 300, qty: 50, unit: 90, total: 90 };
  const xQty = right - cols.total - cols.unit - cols.qty;
  const xUnit = right - cols.total - cols.unit;
  const xTotal = right - cols.total;
  doc.text('Descripción', 40, lineY);
  doc.text('Cant.', xQty, lineY, { width: cols.qty, align: 'right' });
  doc.text('P. unit.', xUnit, lineY, { width: cols.unit, align: 'right' });
  doc.text('Total', xTotal, lineY, { width: cols.total, align: 'right' });

  let y = doc.y + 4;
  doc.fillColor('#111111').font('Helvetica').fontSize(9);
  for (const l of data.lines) {
    doc.text(l.name, 40, y, { width: cols.desc - 8 });
    doc.text(String(l.quantity), xQty, y, { width: cols.qty, align: 'right' });
    doc.text(MONEY(l.unitPrice), xUnit, y, { width: cols.unit, align: 'right' });
    doc.text(MONEY(l.lineTotal), xTotal, y, { width: cols.total, align: 'right' });
    y += 18;
  }
  doc.y = y;

  doc.moveDown(0.6);
  doc.moveTo(40, doc.y).lineTo(right, doc.y).strokeColor(LIGHT).lineWidth(0.6).stroke();
  doc.moveDown(0.4);
  doc.fillColor(GRAY).font('Helvetica-Bold').fontSize(10).text('Subtotal', 40, doc.y, { continued: true });
  doc.text(MONEY(data.subtotal), { align: 'right' });
  doc.moveDown(0.2);
  doc.fillColor(BRAND).font('Helvetica-Bold').fontSize(13).text('TOTAL', 40, doc.y, { continued: true });
  doc.text(MONEY(data.total), { align: 'right' });

  doc.moveDown(1.5);
  doc
    .fillColor(GRAY)
    .font('Helvetica')
    .fontSize(8)
    .text(
      `Emitido el ${data.issuedAt.toLocaleString('es-AR')}. Este presupuesto queda pendiente de ` +
        'aprobación por el cliente. La reparación se iniciará una vez aprobado el presupuesto.',
      { align: 'justify' },
    );

  doc.end();
  });
}
