import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AlignmentType,
  Document,
  HeadingLevel,
  PageBreak,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
} from 'docx';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const outputDir = join(process.cwd(), 'public', 'samples');

async function makeDocx() {
  const document = new Document({
    creator: 'PDF ⇄ Word',
    title: 'Welcome to PDF ⇄ Word',
    description: 'Sample Word document',
    sections: [
      {
        children: [
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 120 },
            children: [new TextRun({ text: 'Welcome to PDF ⇄ Word', bold: true, size: 44, font: 'Calibri' })],
          }),
          new Paragraph({
            alignment: AlignmentType.CENTER,
            spacing: { after: 320 },
            children: [new TextRun({ text: 'A tiny sample document', size: 24, color: '6B6862', font: 'Calibri' })],
          }),
          new Paragraph({
            spacing: { after: 160, line: 300 },
            children: [
              new TextRun({
                text: 'This sample is here so you can try the converter in a single click. ',
                size: 22,
                font: 'Calibri',
              }),
              new TextRun({
                text: 'It never leaves your browser.',
                bold: true,
                size: 22,
                font: 'Calibri',
              }),
            ],
          }),
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            spacing: { before: 220, after: 100 },
            children: [new TextRun({ text: 'What this sample includes', font: 'Calibri' })],
          }),
          new Paragraph({ text: 'Headings, body text, lists, and a small table.', bullet: { level: 0 } }),
          new Paragraph({ text: 'Two pages, so you can check page breaks.', bullet: { level: 0 } }),
          new Paragraph({ text: 'Formatting that survives the round trip.', bullet: { level: 0 } }),
          new Paragraph({
            heading: HeadingLevel.HEADING_2,
            spacing: { before: 220, after: 100 },
            children: [new TextRun({ text: 'A small table', font: 'Calibri' })],
          }),
          new Table({
            rows: [
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Tool', bold: true })] })] }),
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Direction', bold: true })] })] }),
                  new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Format', bold: true })] })] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph('Word to PDF')] }),
                  new TableCell({ children: [new Paragraph('Document → PDF')] }),
                  new TableCell({ children: [new Paragraph('.docx → .pdf')] }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({ children: [new Paragraph('PDF to Word')] }),
                  new TableCell({ children: [new Paragraph('PDF → Document')] }),
                  new TableCell({ children: [new Paragraph('.pdf → .docx')] }),
                ],
              }),
            ],
          }),
          new Paragraph({
            spacing: { before: 260, line: 300 },
            children: [
              new TextRun({
                text: 'Tip: for a PDF with selectable text, convert your Word file, then use Print / Save as PDF.',
                italics: true,
                size: 20,
                color: '6B6862',
                font: 'Calibri',
              }),
            ],
          }),
          new Paragraph({ children: [new PageBreak()] }),
          new Paragraph({
            heading: HeadingLevel.HEADING_1,
            spacing: { after: 120 },
            children: [new TextRun({ text: 'Page two', font: 'Calibri' })],
          }),
          new Paragraph({
            spacing: { after: 160, line: 300 },
            children: [
              new TextRun({
                text: 'This second page confirms that page breaks and multi-page layouts are preserved. ',
                size: 22,
                font: 'Calibri',
              }),
              new TextRun({
                text: 'Try converting this file to PDF, then convert that PDF back to Word.',
                size: 22,
                font: 'Calibri',
              }),
            ],
          }),
          new Paragraph({
            spacing: { after: 120 },
            children: [new TextRun({ text: '1. Drop a file', bold: true, size: 22, font: 'Calibri' })],
          }),
          new Paragraph({
            spacing: { after: 120 },
            children: [new TextRun({ text: '2. Press Convert', bold: true, size: 22, font: 'Calibri' })],
          }),
          new Paragraph({
            spacing: { after: 120 },
            children: [new TextRun({ text: '3. Download the result', bold: true, size: 22, font: 'Calibri' })],
          }),
          new Paragraph({
            spacing: { before: 320 },
            alignment: AlignmentType.CENTER,
            children: [
              new TextRun({
                text: '100% client-side · no uploads · no account',
                size: 20,
                color: '6B6862',
                font: 'Calibri',
              }),
            ],
          }),
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(document);
  await writeFile(join(outputDir, 'sample.docx'), buffer);
}

async function makePdf() {
  const pdf = await PDFDocument.create();
  pdf.setTitle('Welcome to PDF ⇄ Word');
  pdf.setSubject('Sample PDF document');
  pdf.setCreator('PDF ⇄ Word');

  const helvetica = await pdf.embedFont(StandardFonts.Helvetica);
  const helveticaBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const helveticaOblique = await pdf.embedFont(StandardFonts.HelveticaOblique);

  const page1 = pdf.addPage([612, 792]);
  const margin = 72;
  let y = 720;

  page1.drawText('Welcome to PDF <-> Word', {
    x: margin,
    y,
    size: 24,
    font: helveticaBold,
    color: rgb(0.1, 0.1, 0.1),
  });
  y -= 26;
  page1.drawText('A tiny sample document for the PDF to Word converter', {
    x: margin,
    y,
    size: 11,
    font: helvetica,
    color: rgb(0.42, 0.41, 0.38),
  });
  y -= 38;

  const body =
    'This sample is here so you can try the converter in a single click. It never leaves your browser. ' +
    'The text below is real, selectable text, so the editable mode has something to rebuild.';

  for (const line of wrap(body, 78)) {
    page1.drawText(line, { x: margin, y, size: 11, font: helvetica, color: rgb(0.12, 0.12, 0.11) });
    y -= 16;
  }

  y -= 14;
  page1.drawText('What this sample includes', { x: margin, y, size: 16, font: helveticaBold });
  y -= 22;
  for (const item of [
    '- Headings, body text, and bullets.',
    '- Two pages, so you can check page breaks.',
    '- Text that survives the round trip.',
  ]) {
    page1.drawText(item, { x: margin + 8, y, size: 11, font: helvetica, color: rgb(0.15, 0.15, 0.14) });
    y -= 16;
  }

  y -= 14;
  page1.drawText('A small table', { x: margin, y, size: 14, font: helveticaBold });
  y -= 20;
  const rows = [
    ['Tool', 'Direction', 'Format'],
    ['Word to PDF', 'Document to PDF', '.docx to .pdf'],
    ['PDF to Word', 'PDF to Document', '.pdf to .docx'],
  ];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const font = rowIndex === 0 ? helveticaBold : helvetica;
    const columns = [margin, margin + 140, margin + 300];
    rows[rowIndex].forEach((cell, columnIndex) => {
      page1.drawText(cell, { x: columns[columnIndex], y, size: 10.5, font, color: rgb(0.15, 0.15, 0.14) });
    });
    page1.drawLine({
      start: { x: margin, y: y - 6 },
      end: { x: 540, y: y - 6 },
      thickness: 0.5,
      color: rgb(0.85, 0.84, 0.81),
    });
    y -= 20;
  }

  y -= 20;
  page1.drawText('Tip: for a PDF with selectable text, use Print / Save as PDF from the Word side.', {
    x: margin,
    y,
    size: 10,
    font: helveticaOblique,
    color: rgb(0.42, 0.41, 0.38),
  });

  const page2 = pdf.addPage([612, 792]);
  y = 720;
  page2.drawText('Page two', { x: margin, y, size: 18, font: helveticaBold });
  y -= 30;
  for (const line of wrap(
    'This second page confirms that multi-page PDFs are handled. Convert this PDF to Word to get editable paragraphs, then convert it back to PDF if you want to compare the results.',
    82,
  )) {
    page2.drawText(line, { x: margin, y, size: 11, font: helvetica, color: rgb(0.12, 0.12, 0.11) });
    y -= 16;
  }

  y -= 24;
  page2.drawText('1. Drop a file', { x: margin, y, size: 11, font: helveticaBold });
  y -= 18;
  page2.drawText('2. Press Convert', { x: margin, y, size: 11, font: helveticaBold });
  y -= 18;
  page2.drawText('3. Download the result', { x: margin, y, size: 11, font: helveticaBold });

  page2.drawText('100% client-side · no uploads · no account', {
    x: margin,
    y: 100,
    size: 10,
    font: helvetica,
    color: rgb(0.42, 0.41, 0.38),
  });

  await writeFile(join(outputDir, 'sample.pdf'), await pdf.save());
}

async function makeScannedPdf() {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
  page.drawRectangle({ x: 0, y: 0, width: 612, height: 792, color: rgb(0.98, 0.98, 0.97) });
  page.drawRectangle({ x: 60, y: 700, width: 300, height: 24, color: rgb(0.2, 0.2, 0.2) });
  for (let index = 0; index < 22; index += 1) {
    const width = 380 + ((index * 47) % 100);
    page.drawRectangle({
      x: 72,
      y: 650 - index * 22,
      width,
      height: 8,
      color: rgb(0.55, 0.55, 0.54),
    });
  }
  page.drawRectangle({ x: 72, y: 100, width: 468, height: 2, color: rgb(0.7, 0.7, 0.68) });
  await writeFile(join(outputDir, 'scanned-sample.pdf'), await pdf.save());
}

function wrap(text, maxChars) {
  const words = text.split(/\s+/);
  const lines = [];
  let current = '';
  for (const word of words) {
    if (!current) {
      current = word;
    } else if (`${current} ${word}`.length <= maxChars) {
      current += ` ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

await mkdir(outputDir, { recursive: true });
await makeDocx();
await makePdf();
await makeScannedPdf();
console.log('Created public/samples/sample.docx, sample.pdf, and scanned-sample.pdf');
