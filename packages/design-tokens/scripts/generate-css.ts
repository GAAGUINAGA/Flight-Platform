/* global __dirname */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import process from 'node:process';
import { tokensToCss } from '../src/css';

// Escribe tokens.css junto al paquete. Lo ejecuta `npm run build` (y `npm run generate`) de este workspace.
const target = join(__dirname, '..', 'tokens.css');
writeFileSync(target, tokensToCss());
process.stdout.write('design-tokens: tokens.css generado\n');
