from diarization import SpeakerDiagnostics
from transcript_merge import TranscriptMerge


class Detector:
    def __init__(self, matches=True):
        self.matches = matches
        self.calls = 0

    def duplicate(self, first, second):
        self.calls += 1
        return self.matches


def segment(source, start=0, end=2, text='Hello everyone how are you doing today'):
    return dict(source=source, start=start, end=end, text=text, speaker=None)


def test_hold_until_opposite_phrase_ready_and_prefer_system_echo_copy():
    diagnostics = SpeakerDiagnostics()
    merge = TranscriptMerge(Detector(), True, diagnostics)
    merge.add(segment('microphone'))
    assert merge.drain(0) == []
    merge.add(segment('system'))
    rows = merge.drain(2)
    assert [row['source'] for row in rows] == ['system']
    assert diagnostics.snapshot()['echo_duplicates_suppressed'] == 1
    assert merge.drain(5) == []


def test_force_flush_and_distinct_speech_keep_both_without_repeated_comparison():
    detector = Detector(False)
    merge = TranscriptMerge(detector, True, SpeakerDiagnostics())
    merge.add(segment('microphone'))
    merge.add(segment('system'))
    assert merge.drain(0) == []
    assert merge.drain(.5) == []
    assert detector.calls == 1
    assert len(merge.drain(0, force=True)) == 2
    assert merge.drain(10, force=True) == []


def test_single_source_and_short_replies_need_no_cross_source_wait():
    merge = TranscriptMerge(Detector(), False, SpeakerDiagnostics())
    merge.add(segment('microphone'))
    assert len(merge.drain(0)) == 1
    merge = TranscriptMerge(Detector(), True, SpeakerDiagnostics())
    merge.add(segment('microphone', text='Yes, okay'))
    assert len(merge.drain(0)) == 1
