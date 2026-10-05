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

await build({entryPoints:['client/documents.js'],bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:'dist/client/documents.js',minify:true});
await cp('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs','dist/client/pdf.worker.mjs');
await mkdir('dist/client/pdf',{recursive:true});
for(const folder of ['cmaps','standard_fonts'])await cp('node_modules/pdfjs-dist/'+folder,'dist/client/pdf/'+folder,{recursive:true});
