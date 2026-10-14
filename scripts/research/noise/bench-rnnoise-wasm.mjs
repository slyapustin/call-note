import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const {default:create}=await import(pathToFileURL(path.resolve('.build/noise-research/rnnoise-sync.mjs')));
const [input, output] = process.argv.slice(2);
const data=fs.readFileSync(input);
const source=new Int16Array(data.buffer,data.byteOffset,data.length/2);
const t0=performance.now(); const m=create(); const initMs=performance.now()-t0;
const state=m._rnnoise_create(0); const ptr=m._malloc(480*4); const heap=m.HEAPF32;
const offset=ptr/4; const samples=Math.ceil(source.length/480)*480;
const result=new Int16Array(samples); const frameMs=[]; const start=performance.now();
// RNNoise 0.2 has two frames of algorithmic delay; flush and omit both.
for(let frame=0;frame<samples/480+2;frame++) {
 for(let j=0;j<480;j++) heap[offset+j]=source[frame*480+j] ?? 0;
 const frameStart=performance.now(); m._rnnoise_process_frame(state,ptr,ptr); frameMs.push(performance.now()-frameStart);
 if(frame>1) for(let j=0;j<480;j++) result[(frame-2)*480+j]=Math.max(-32768,Math.min(32767,Math.round(heap[offset+j])));
}
const processingMs=performance.now()-start;
m._rnnoise_destroy(state); m._free(ptr);
fs.writeFileSync(output,Buffer.from(result.buffer,0,source.length*2));
frameMs.sort((a,b)=>a-b); console.log(JSON.stringify({p95Ms:frameMs[Math.floor(frameMs.length*.95)],p99Ms:frameMs[Math.floor(frameMs.length*.99)],engine:'jitsi-sync-rnnoise0.2',sourceSamples:source.length,initMs,processingMs,rtf:processingMs/(source.length/48)}));
