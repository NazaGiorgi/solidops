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

const jestPath = path.resolve(__dirname, '..', 'node_modules', '.bin', process.platform === 'win32' ? 'jest.cmd' : 'jest');
const jestArgs = ['--config', path.resolve(__dirname, 'jest-e2e.json')];

const child = spawn(jestPath, jestArgs, { stdio: 'inherit', env: process.env });

child.on('close', (code) => {
  process.exit(code);
});
