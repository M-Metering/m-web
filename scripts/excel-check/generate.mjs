// Generates sample workbooks with the app's real export code, for manual /
// automated inspection in Microsoft Excel (see verify-excel.ps1).
// Run: npx vite-node scripts/excel-check/generate.mjs <outDir>
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { buildXlsxBuffer, normalizeIdentifierCells, COLUMN_TYPES } from '../../src/utils/xlsx.js';
import { normalizeMultiRow, normalizeJedRow, JED_BUCKET } from '../../src/utils/installationScope.js';
import { buildCompletedInstallationsReport, buildMeterIndex } from '../../src/utils/completedInstallationsReport.js';

const outDir = process.argv[2] || 'excel-check-out';
fs.mkdirSync(outDir, { recursive: true });

// 1) Completed installations report — identifiers with leading zeros, a
//    19-digit SIM, a 12-digit RRR, blanks, dates and amounts.
const rows = [
  normalizeMultiRow({
    id: 101, accountNumber: '0100234567', customerName: 'ADA OBI', customerPhone: '08149454601',
    customerAddress: '3 NWACHUKWU STREET, ABA NORTH', discoCode: 'ABA_POWER', status: 'INSTALLED',
    meterType: 'SINGLE PHASE', feederName: 'ABA GRA 11KV', transformerName: 'JOHNSON', transformerCode: '0045',
    installationPosition: 'HIGH WALL', meterNumber: '0239110006909', sealNumber: '000991',
    installationDate: '2026-09-07', reportedAt: '2026-09-07T15:04:00Z', installerName: 'Musa Bello',
    assignedTo: '3904aad1-2f27-42d1-9c33-fe87502ea594', assignedAt: '2026-09-02T08:00:00Z',
    latitude: 5.1066, longitude: 7.3667, discoSupervisor: 'I. Okafor',
    installationPhotoUrl: 'https://photos.example.com/101.jpg', createdAt: '2026-09-01T09:00:00Z',
  }),
  normalizeJedRow({
    id: 12, accountNumber: '0477014', custNames: 'ABUTU AUGUSTINE', gsm: '+2348036233685',
    email: 'customer@example.com', address: 'UPHILLS BRIGHTWAY RUKUBA ROAD', discoCode: 'JED001',
    region: 'DILIMI', requestRef: 'REF123456', rrr: '020799142825', orderId: '1633177984000',
    amount: 67000, status: 'COMPLETED', meterType: 'Three Phase', meterNo: '0123456789012', sealNo: '9900',
    dateRequested: '2026-08-01T10:00:00Z', datePaid: '2026-08-02T11:30:00Z', dateCompleted: '2026-09-05T10:00:00Z',
  }, JED_BUCKET),
];
const meterIndex = buildMeterIndex([
  { meterNumber: '0239110006909', simNumber: '8923401000012345678', meterMake: 'MASTER ENERGY', model: 'ME-1P', sgcNumber: '0600123', phaseType: 'SINGLE PHASE', status: 'INSTALLED' },
  { meterNumber: '0123456789012', simNumber: '0892340100001234567', meterMake: 'MASTER ENERGY', model: 'ME-3P', sgcNumber: '999962', phaseType: 'THREE PHASE', status: 'INSTALLED' },
]);
const report = buildCompletedInstallationsReport({
  rows,
  meterIndex,
  context: { scopeLabel: 'All discos', filters: ['Feeder: ABA GRA 11KV'], generatedAt: new Date(), meterDetails: '' },
});
fs.writeFileSync(path.join(outDir, 'completed-installations.xlsx'), Buffer.from(await buildXlsxBuffer(report.sheets)));

// 2) Client export shape (Reports) — text identifiers, currency, datetime.
fs.writeFileSync(path.join(outDir, 'admin-reports.xlsx'), Buffer.from(await buildXlsxBuffer([{
  name: 'Customer Requests',
  columns: [
    { header: 'Account Number', key: 'a', type: COLUMN_TYPES.TEXT },
    { header: 'Meter Number', key: 'm', type: COLUMN_TYPES.TEXT },
    { header: 'Amount (₦)', key: 'amt', type: COLUMN_TYPES.CURRENCY },
    { header: 'Payment Reference (RRR)', key: 'rrr', type: COLUMN_TYPES.TEXT },
    { header: 'Submitted Date', key: 'd', type: COLUMN_TYPES.DATETIME },
  ],
  rows: [
    { a: '0012345', m: '0000000000001', amt: 67000.5, rrr: '120799142825', d: '2026-09-07T15:04:00Z' },
    { a: '477014', m: '', amt: null, rrr: null, d: null },
  ],
}])));

// 2b) Meter numbers at every valid length (10-13 digits), including ones with
//     and without a leading zero. Excel must show each one exactly as written
//     — no padding, no truncation, no scientific notation.
fs.writeFileSync(path.join(outDir, 'meter-number-lengths.xlsx'), Buffer.from(await buildXlsxBuffer([{
  name: 'Meter Numbers',
  columns: [
    { header: 'Meter Number', key: 'm', type: COLUMN_TYPES.TEXT },
    { header: 'Digits', key: 'n', type: COLUMN_TYPES.NUMBER },
  ],
  rows: [
    '1234567890', '0234567890', // 10
    '14534512345', '01453451234', // 11
    '145345123456', '014534512345', // 12
    '1453451234567', '0239110006909', // 13
  ].map((m) => ({ m, n: m.length })),
}])));

// 3) A "server" workbook that stored identifiers as numbers, after the fix-up.
//    The meter column deliberately holds 10-, 11- and 12-digit values: they
//    must come out with exactly those digits, never padded up to 13.
const server = new ExcelJS.Workbook();
const ws = server.addWorksheet('Meters');
ws.addRow(['Meter Number', 'SIM Card Serial Number', 'Customer Account number', 'Amount', 'Phase']);
ws.addRow([239110006909, 8923401000012345000, 100234567, 67000, 'SINGLE PHASE']);
ws.addRow(['0239110006917', '8923401000012345679', '0477014', 50000, 'THREE PHASE']);
ws.addRow([1234567890, '8923401000012345680', 100234568, 45000, 'SINGLE PHASE']);
ws.addRow([14534512345, '8923401000012345681', 100234569, 45000, 'THREE PHASE']);
fs.writeFileSync(path.join(outDir, 'server-before.xlsx'), Buffer.from(await server.xlsx.writeBuffer()));
const changed = normalizeIdentifierCells(server);
fs.writeFileSync(path.join(outDir, 'server-after.xlsx'), Buffer.from(await server.xlsx.writeBuffer()));

console.log(`wrote ${report.count} report rows, fixed ${changed} server cells ->`, path.resolve(outDir));
