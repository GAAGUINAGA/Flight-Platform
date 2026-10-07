import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../../..');
const output = resolve(import.meta.dirname, '../src/generated');
mkdirSync(output, { recursive: true });
const openapi = resolve(root, 'node_modules/openapi-typescript/bin/cli.js');
execFileSync(process.execPath, [openapi, 'contracts/openapi/vuelos-openapi.yaml', '-o', 'packages/contracts/src/generated/openapi.ts'], {
  cwd: root, stdio: 'inherit'
});

const protoRoot = resolve(root, 'contracts/proto');
const grpcOutput = resolve(output, 'grpc');
mkdirSync(grpcOutput, { recursive: true });
const files = [];
function collect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) collect(path);
    else if (entry.name.endsWith('.proto')) files.push(path);
  }
}
collect(protoRoot);
const protoc = resolve(root, 'node_modules/grpc-tools/bin/protoc.js');
const plugin = resolve(root, `node_modules/.bin/protoc-gen-ts_proto${process.platform === 'win32' ? '.cmd' : ''}`);
execFileSync(process.execPath, [protoc, `--plugin=protoc-gen-ts_proto=${plugin}`, `--ts_proto_out=${grpcOutput}`,
  '--ts_proto_opt=nestJs=true', `--proto_path=${protoRoot}`, ...files], { cwd: root, stdio: 'inherit' });
