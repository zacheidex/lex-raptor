import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import {extractDocument,checkCollection,MAX_FILE_BYTES} from '../shared/extract.js';
pdfjs.GlobalWorkerOptions.workerSrc='/pdf.worker.mjs';
export async function extractFiles(files,existing=[]){
 if(existing.length+files.length>5)throw new Error('Attach up to five documents at a time.');
 const docs=[];for(const file of files){if(file.size>MAX_FILE_BYTES)throw new Error(file.name+': file exceeds 5 MB.');docs.push(await extractDocument(file.name,new Uint8Array(await file.arrayBuffer()),pdfjs));checkCollection([...existing,...docs]);}return docs;
}
