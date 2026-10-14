from pathlib import Path
import ctypes,wave,array,subprocess,time,json
p=Path(__file__).resolve().parents[3]/'.build/noise-research'
lib=ctypes.CDLL(str(p/'rnnoise/librnnoise-bench.dylib'))
lib.rnnoise_create.argtypes=[ctypes.c_void_p];lib.rnnoise_create.restype=ctypes.c_void_p
lib.rnnoise_process_frame.argtypes=[ctypes.c_void_p,ctypes.POINTER(ctypes.c_float),ctypes.POINTER(ctypes.c_float)]
lib.rnnoise_process_frame.restype=ctypes.c_float
lib.rnnoise_destroy.argtypes=[ctypes.c_void_p]
results=[]
for src in [p/'fixtures'/'clean.wav']:
 with wave.open(str(src),'rb') as w:
  assert w.getframerate()==48000 and w.getnchannels()==1 and w.getsampwidth()==2
  raw=w.readframes(w.getnframes());data=array.array('h',raw)
 rawpath=p/'fixtures'/f'{src.stem}.pcm';rawpath.write_bytes(raw)
 st=lib.rnnoise_create(None);frame=(ctypes.c_float*480)();out=array.array('h');times=[]
 start=time.perf_counter()
 for offset in range(0,len(data)+960,480):
  for j in range(480):frame[j]=data[offset+j] if offset+j<len(data) else 0
  t=time.perf_counter();lib.rnnoise_process_frame(st,frame,frame);times.append((time.perf_counter()-t)*1000)
  if offset>=960:out.extend(max(-32768,min(32767,round(x))) for x in frame)
 elapsed=time.perf_counter()-start;lib.rnnoise_destroy(st)
 times.sort();duration=len(data)/48000
 result={'engine':'rnnoise-native-current','fixture':src.name,'duration':duration,'wallSeconds':elapsed,'rtf':elapsed/duration,'inferenceSeconds':sum(times)/1000,'p95Ms':times[int(len(times)*.95)],'p99Ms':times[int(len(times)*.99)]};results.append(result);print(json.dumps(result))
 with wave.open(str(p/'fixtures'/f'{src.stem}-rnnoise-native.wav'),'wb') as w:
  w.setparams((1,2,48000,0,'NONE','not compressed'));w.writeframes(out[:len(data)].tobytes())
 wasmraw=p/'fixtures'/f'{src.stem}-rnnoise-wasm.pcm'
 r=subprocess.run(['node',str(Path(__file__).with_name('bench-rnnoise-wasm.mjs')),str(rawpath),str(wasmraw)],capture_output=True,text=True,check=True)
 result=json.loads(r.stdout);result['fixture']=src.name;results.append(result);print(json.dumps(result))
 with wave.open(str(wasmraw.with_suffix('.wav')),'wb') as w:
  w.setparams((1,2,48000,0,'NONE','not compressed'));w.writeframes(wasmraw.read_bytes())
(p/'rnnoise-clean-benchmark.json').write_text(json.dumps(results,indent=2))
