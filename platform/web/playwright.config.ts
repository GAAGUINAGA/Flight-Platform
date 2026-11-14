import process from 'node:process';
import { defineConfig } from '@playwright/test';

/**
 * Extremo a extremo contra la plataforma local (`npm run local:up -- -SkipDocker -Web`). No levanta nada por su cuenta.
 * Usa un navegador ya instalado (Edge por omisión; `E2E_BROWSER_CHANNEL=chrome` para Chrome): no descarga navegadores.
 * La zona horaria del navegador es Tokio a propósito: las horas de vuelo deben salir en la hora local del AEROPUERTO, no en la del dispositivo.
 */
export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.e2e.ts',
  timeout: 90_000,
  expect: { timeout: 30_000 },
  workers: 1,
  retries: 0,
  reporter: [['list']],
  outputDir: '../../.local/e2e-results',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    channel: process.env.E2E_BROWSER_CHANNEL ?? 'msedge',
    locale: 'es-EC',
    timezoneId: 'Asia/Tokyo',
    trace: 'off',
    screenshot: 'only-on-failure'
  }
});
