'use strict';

const fs = require('fs/promises');
const path = require('path');
const JSZip = require('jszip');
const QRCode = require('qrcode');
const { buildQRPayload, buildRegistry } = require('./qr-registry');

const SECRET = process.env.SECRET;
const OUT_DIR = path.resolve(process.argv[2] || 'qr-output');
const ZIP_PATH = `${OUT_DIR}.zip`;

function ensureSecret() {
  if (!SECRET || SECRET === 'change-me-in-render-env') {
    console.error('Set SECRET first. It must match the Android app and Render server SECRET.');
    console.error('PowerShell example: $env:SECRET="your-secret"; npm run generate-qrs');
    process.exit(1);
  }
}

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
  const email = safeFilePart(participant.email?.split('@')[0]);
  const base = [id, name || email || participant.uid].filter(Boolean).join('_');
  return `${String(index + 1).padStart(4, '0')}_${base || participant.uid}.png`;
}

async function main() {
  ensureSecret();

  const registry = await buildRegistry(SECRET);
  const zip = new JSZip();

  await fs.rm(OUT_DIR, { recursive: true, force: true });
  await fs.mkdir(OUT_DIR, { recursive: true });

  for (const [index, participant] of registry.entries()) {
    const qrData = buildQRPayload(SECRET, participant);
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

  console.log(`Generated ${registry.length} QR images`);
  console.log(`Folder: ${OUT_DIR}`);
  console.log(`ZIP: ${ZIP_PATH}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
