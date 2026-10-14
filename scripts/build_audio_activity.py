"""Build the read-only CoreAudio activity helper for Apple Silicon macOS."""
import argparse
from pathlib import Path
import subprocess
import sys


ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, default=ROOT / '.build' / 'audio-activity')
    args = parser.parse_args()
    if sys.platform != 'darwin':
        parser.error('The CoreAudio helper must be built on macOS with Xcode command-line tools.')
    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([
        'xcrun', 'clang', '-arch', 'arm64', '-mmacosx-version-min=14.2',
        '-fobjc-arc', '-O2', '-Wall', '-Wextra', '-Werror',
        str(ROOT / 'desktop' / 'native' / 'audio-activity.m'),
        '-framework', 'Foundation', '-framework', 'CoreAudio',
        '-o', str(output),
    ], check=True)
    print(output)


if __name__ == '__main__':
    main()
