import os
import wave
import numpy as np
import pytest
from call_audio import CallAudio, audio_info, audio_path
from call_store import CallStore


def test_stereo_alignment_channels_peaks_and_incremental_header(tmp_path):
    cid='a'*32
    audio=CallAudio(tmp_path,cid,['system','microphone'])
    audio.write('system',np.array([.25,-.25],dtype='<f4').tobytes(),2/16000)
    audio.write('microphone',np.array([2,-2,.5],dtype='<f4').tobytes(),0)
    with wave.open(str(audio.path),'rb') as wav:
        assert wav.getnchannels()==2
        assert wav.getframerate()==16000
        data=np.frombuffer(wav.readframes(10),dtype='<i2').reshape(-1,2)
    np.testing.assert_array_equal(data,[[32767,0],[-32767,0],[16383,8191],[0,-8191]])
    assert audio_info(tmp_path,cid)['seconds']==4/16000
    if os.name!='nt':
        assert audio.path.stat().st_mode & 0o777 == 0o600
    audio.close()


def test_saved_audio_deleted_with_call_and_recording_call_protected(tmp_path):
    store=CallStore(tmp_path); call=store.create('Local')
    audio=CallAudio(tmp_path,call['id'],['microphone'])
    audio.write('microphone',np.full(800,.1,dtype='<f4').tobytes(),0)
    assert store.get(call['id'])['audio'] is None
    with pytest.raises(ValueError): store.delete(call['id'])
    audio.close();store.finish(call['id'],.05)
    assert CallStore(tmp_path).get(call['id'])['audio']['channels']==1
    store.delete(call['id']);assert not audio.path.exists()


def test_paths_and_damaged_audio_cannot_break_library(tmp_path):
    with pytest.raises(KeyError): audio_path(tmp_path,'../secrets')
    store=CallStore(tmp_path);call=store.create('Damaged audio')
    path=audio_path(tmp_path,call['id']);path.parent.mkdir();path.write_bytes(b'bad')
    store.finish(call['id'],1)
    assert store.get(call['id'])['audio'] is None
    store.delete(call['id']);assert not path.exists()
