import {build} from 'esbuild';
import {mkdir, rm, cp, access} from 'node:fs/promises';
await rm('dist', {recursive:true, force:true});
await mkdir('dist/server', {recursive:true});
await mkdir('dist/.openai', {recursive:true});
await cp('public', 'dist/client', {recursive:true});
let manifest='.openai/hosting.json';
try {await access(manifest);} catch {manifest='hosting.example.json';}
await cp(manifest, 'dist/.openai/hosting.json');
await cp('drizzle', 'dist/.openai/drizzle', {recursive:true});
await build({entryPoints:['worker/index.js'],bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:'dist/server/index.js'});
