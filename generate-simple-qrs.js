'use strict';

const fs = require('fs/promises');
const path = require('path');
const JSZip = require('jszip');
const QRCode = require('qrcode');
const { PARTICIPANTS } = require('./qr-registry');

const OUT_DIR = path.resolve(process.argv[2] || 'qr-simple-output');
const ZIP_PATH = `${OUT_DIR}.zip`;

function safeFilePart(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '')
    .replace(/\s+/g, '_')
    .replace(/[^\w.@-]+/g, '')
    .slice(0, 80);
}

function fileNameFor(participant, index) {
  const id = safeFilePart(participant.sid);
  const name = safeFilePart(participant.name);
  return `${String(index + 1).padStart(4, '0')}_${id}_${name || participant.email || 'participant'}.png`;
}

async function main() {
  const zip = new JSZip();

  await fs.rm(OUT_DIR, { recursive: true, force: true });
  await fs.mkdir(OUT_DIR, { recursive: true });

  for (const [index, participant] of PARTICIPANTS.entries()) {
    const qrData = JSON.stringify({
      name: participant.name,
      mssv: participant.sid,
    });
    const fileName = fileNameFor(participant, index);
    const png = await QRCode.toBuffer(qrData, {
      type: 'png',
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 512,
    });

    await fs.writeFile(path.join(OUT_DIR, fileName), png);
    zip.file(fileName, png);
  }

  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer' });
  await fs.writeFile(ZIP_PATH, zipBuffer);

  console.log(`Generated ${PARTICIPANTS.length} simple QR images`);
  console.log(`Folder: ${OUT_DIR}`);
  console.log(`ZIP: ${ZIP_PATH}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
