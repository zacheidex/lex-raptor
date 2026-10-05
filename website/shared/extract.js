import {unzipSync} from 'fflate';
import {DOMParser} from '@xmldom/xmldom';
export const MAX_FILE_BYTES=5*1024*1024,MAX_TEXT_BYTES=300000,MAX_DOCUMENTS=5,MAX_PAGES=200;
const encoder=new TextEncoder();
const normalize=s=>s.replace(/\u0000/g,'').replace(/\s+/g,' ').trim();
export function documentSize(doc){return doc.pages.reduce((n,p)=>n+encoder.encode(p.text).length,0);}
export function checkCollection(docs){if(docs.length>MAX_DOCUMENTS)throw new Error('Attach up to five documents at a time.');if(docs.reduce((n,d)=>n+documentSize(d),0)>MAX_TEXT_BYTES)throw new Error('Combined extracted text exceeds 300 KB. Split the documents or select shorter sections.');return docs;}
export async function extractDocument(filename,bytes,pdfjs){
 const name=filename.split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g,'').slice(0,160);
 if(!name||!bytes.length)throw new Error('The selected file is empty.');
 if(bytes.length>MAX_FILE_BYTES)throw new Error(name+': file exceeds 5 MB.');
 const ext=name.split('.').pop().toLowerCase();let pages=[],type='',warnings=[];
 if(['txt','md','markdown'].includes(ext)){
  type='text';let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{throw new Error(name+': save text as UTF-8 first.');}
  if(text.includes('\u0000'))throw new Error(name+': binary content is not a text document.');
  pages=[{number:1,text:normalize(text)}];
 }else if(ext==='docx'){
  type='DOCX';let expanded=0;
  const entries=unzipSync(bytes,{filter:entry=>{if(!/^word\/(document|footnotes|endnotes)\.xml$/.test(entry.name))return false;expanded+=entry.originalSize;if(expanded>4000000)throw new Error(name+': expanded document XML exceeds 4 MB.');return true;}});
  if(!entries['word/document.xml'])throw new Error(name+': no DOCX document body found.');
  for(const part of ['document','footnotes','endnotes']){
   if(!entries['word/'+part+'.xml'])continue;
   const xml=new TextDecoder('utf-8',{fatal:true}).decode(entries['word/'+part+'.xml']);
   if(/<!DOCTYPE|<!ENTITY/i.test(xml))throw new Error(name+': unsupported XML declarations.');
   const dom=new DOMParser({onError:()=>{throw new Error(name+': invalid DOCX XML.');}}).parseFromString(xml,'text/xml');
   let text='';const walk=node=>{if(node.nodeType===1){if(['del','txbxContent'].includes(node.localName))return;if(node.localName==='t'){text+=node.textContent;return;}if(['tab','br','cr'].includes(node.localName)){text+=' ';return;}}for(let child=node.firstChild;child;child=child.nextSibling)walk(child);if(node.nodeType===1&&['p','tr'].includes(node.localName))text+='\n';};walk(dom.documentElement);
   pages.push({number:pages.length+1,text:normalize(text),label:part==='document'?'Document body':part});
  }
  warnings.push('DOCX page layout, tracked deletions, comments, text boxes, headers and formatting are not represented. Review the original.');
 }else if(ext==='pdf'){
  type='PDF';if(!pdfjs)throw new Error('PDF parser is unavailable.');
  const task=pdfjs.getDocument({data:bytes,isEvalSupported:false,disableFontFace:true,useSystemFonts:false,useWasm:false,verbosity:0,...(typeof window!=='undefined'?{cMapUrl:'/pdf/cmaps/',cMapPacked:true,standardFontDataUrl:'/pdf/standard_fonts/'}:{})});
  const timeout=setTimeout(()=>task.destroy(),45000);
  try{
   const pdf=await task.promise;if(pdf.numPages>MAX_PAGES)throw new Error(name+': exceeds 200 pages. Split the PDF first.');
   let extracted=0,empty=0;
   for(let number=1;number<=pdf.numPages;number++){
    const page=await pdf.getPage(number),content=await page.getTextContent();
    const text=normalize(content.items.map(item=>item.str||'').join(' '));
    extracted+=encoder.encode(text).length;if(extracted>MAX_TEXT_BYTES)throw new Error(name+': extracted text exceeds 300 KB. Split the PDF first.');
    if(!text)empty++;pages.push({number,text});page.cleanup();
   }
   if(empty)warnings.push(empty+' page(s) had no extractable text. Scanned images are not read; OCR is not included.');
  }catch(e){if(e.name==='PasswordException')throw new Error(name+': password-protected PDFs are not supported.');throw e;}finally{clearTimeout(timeout);await task.destroy();}
 }else throw new Error(name+': supported formats are PDF, DOCX, TXT and Markdown.');
 if(!pages.some(p=>p.text))throw new Error(name+': no readable text found. Scanned PDFs need OCR first.');
 const doc={name,type,pages,warnings};checkCollection([doc]);return doc;
}
