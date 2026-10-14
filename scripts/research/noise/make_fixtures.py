from pathlib import Path
import numpy as np
import soundfile as sf
from scipy.signal import resample_poly, butter, sosfilt
out=Path('.build/noise-research/fixtures'); out.mkdir(parents=True, exist_ok=True); sr=48000
speech,rate=sf.read('samples/long-clean.wav'); speech=resample_poly(speech[:rate*30],3,1)
clean=np.pad(speech,(2*sr,2*sr)); clean=clean/max(abs(clean))*.4
rng=np.random.default_rng(20261014); t=np.arange(len(clean))/sr
fan=sosfilt(butter(2,1200,fs=sr,output='sos'),rng.normal(size=len(clean)))+.15*np.sin(2*np.pi*120*t)
keys=np.zeros(len(clean))
for start in rng.integers(0,len(clean)-2400,170):
    burst=rng.normal(size=2400)*np.exp(-np.arange(2400)/220)
    keys[start:start+2400]+=burst
noise=fan/np.std(fan)*.7+keys/max(np.std(keys),1e-9)*.3
active=np.abs(clean)>.02
rms=np.sqrt(np.mean(clean[active]**2))
sf.write(out/'clean.wav',clean,sr,subtype='PCM_16')
for snr in [0,5,10]:
    n=noise/np.std(noise)*rms/10**(snr/20)
    mixed=clean+n
    scale=max(1,float(np.max(np.abs(mixed)))/.95)
    sf.write(out/f'noisy-{snr}db.wav',mixed/scale,sr,subtype='PCM_16')
    sf.write(out/f'reference-{snr}db.wav',clean/scale,sr,subtype='PCM_16')
print('48 kHz mono, 34 s each, 30 s synthetic speech + 2 s noise-only at each end; deterministic fan/hum and impulse noise. SNR measured against active speech samples, not whole-file RMS.')
