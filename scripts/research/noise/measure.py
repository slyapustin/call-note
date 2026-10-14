from pathlib import Path
import json, numpy as np, soundfile as sf
from scipy.signal import correlate, correlation_lags
root=Path('.build/noise-research'); sr=48000

def metric(ref, audio):
    n=min(len(ref),len(audio)); ref=ref[:n];audio=audio[:n]
    # Allow at most 100ms to align pipeline delay; score speech region only.
    corr=correlate(audio,ref,mode='full',method='fft');lags=correlation_lags(len(audio),len(ref));mask=abs(lags)<=4800
    lag=int(lags[mask][np.argmax(corr[mask])])
    if lag>0: audio=audio[lag:]; ref=ref[:-lag]
    elif lag<0: ref=ref[-lag:];audio=audio[:lag]
    s=ref[2*sr:30*sr];y=audio[2*sr:30*sr];s=s-np.mean(s);y=y-np.mean(y)
    alpha=np.dot(y,s)/np.dot(s,s);target=alpha*s;err=y-target
    score=10*np.log10(np.dot(target,target)/(np.dot(err,err)+1e-20))
    return {'aligned_si_sdr_db':round(float(score),2),'lag_samples':lag,'speech_gain_db':round(float(20*np.log10(abs(alpha)+1e-20)),2)}
results=[]
for snr in [0,5,10]:
    ref,_=sf.read(root/f'fixtures/reference-{snr}db.wav');raw,_=sf.read(root/f'fixtures/noisy-{snr}db.wav')
    for engine,folder in [('bypass','fixtures'),('DeepFilterNet3','df-out'),('RNNoise-native','fixtures'),('RNNoise-WASM','fixtures')]:
        suffix={'RNNoise-native':'-rnnoise-native','RNNoise-WASM':'-rnnoise-wasm'}.get(engine,'')
        p=root/folder/f'noisy-{snr}db{suffix}.wav'
        if not p.exists():continue
        y,_=sf.read(p);row={'engine':engine,'input_snr_label':snr,**metric(ref,y)}
        a=raw[sr:sr*2];b=y[sr:sr*2]
        row['noise_only_attenuation_db']=round(float(10*np.log10((np.mean(a*a)+1e-20)/(np.mean(b*b)+1e-20))),2)
        results.append(row)
print(json.dumps(results,indent=2))
(root/'metrics.json').write_text(json.dumps(results,indent=2)+'\n')
