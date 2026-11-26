#!/usr/bin/env node
const { spawn } = require('child_process');
const path = require('path');

const dbHost = process.env.DB_HOST || 'postgres';
const dbPort = process.env.DB_PORT || '5432';
const dbName = process.env.DB_NAME || 'ops_msp_e2e';
const allowDb = process.env.E2E_ALLOW_DB || `${dbHost}:${dbPort}/${dbName}`;
const adminEmail = process.env.E2E_ADMIN_EMAIL || 'ana@msp.local';
const adminPassword = process.env.E2E_ADMIN_PASSWORD || 'demo1234';

process.env.DB_NAME = dbName;
process.env.E2E_ALLOW_DB = allowDb;
process.env.E2E_ADMIN_EMAIL = adminEmail;
process.env.E2E_ADMIN_PASSWORD = adminPassword;

// Invocar el binario JS con el mismo Node evita `spawn EINVAL` al ejecutar
// jest.cmd desde Windows (Node >= 20) y funciona igual en Linux/macOS.
const jestPath = path.resolve(__dirname, '..', 'node_modules', 'jest', 'bin', 'jest.js');
// Un solo worker: el schema se sincroniza al iniciar la app y varias suites en
// paralelo pueden competir por el mismo índice (idx_document_search_gin).
// --forceExit: las suites dejan timers abiertos del worker de casillas; Jest ya
// terminó todos los tests y el runner debe devolver el control igualmente.
const jestArgs = [
  jestPath,
  '--config',
  path.resolve(__dirname, 'jest-e2e.json'),
  '--runInBand',
  '--forceExit',
];

const child = spawn(process.execPath, jestArgs, { stdio: 'inherit', env: process.env });

child.on('close', (code) => {
  process.exit(code);
});
