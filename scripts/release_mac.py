"""Sign, optionally notarize, and create a drag-to-Applications DMG."""
import argparse
import base64
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import shutil
import subprocess

ROOT=Path(__file__).resolve().parents[1]
MACHO={b'\xfe\xed\xfa\xce',b'\xce\xfa\xed\xfe',b'\xfe\xed\xfa\xcf',b'\xcf\xfa\xed\xfe',b'\xca\xfe\xba\xbe',b'\xbe\xba\xfe\xca'}

def run(*args):
    result=subprocess.run([str(a) for a in args],capture_output=True,text=True)
    if result.returncode:raise SystemExit(result.stdout+result.stderr)
    if str(args[0]) not in ('codesign',):print(result.stdout.strip(),flush=True)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--app',type=Path,required=True)
    parser.add_argument('--identity',help='Developer ID Application identity; defaults to ad-hoc preview')
    parser.add_argument('--notary-profile',help='Existing notarytool keychain profile; credentials are never stored in the repo')
    parser.add_argument('--sign-only',action='store_true',help='Sign and verify the app without making a DMG')
    args=parser.parse_args()
    app=args.app.resolve()
    for cache in app.rglob('__pycache__'):
        if cache.is_dir():shutil.rmtree(cache)
    service_cache=app/'Contents/Resources/service/.cache'
    if service_cache.exists():shutil.rmtree(service_cache)
    version=json.loads((ROOT/'desktop/package.json').read_text())['version']
    output=ROOT/'release';output.mkdir(exist_ok=True)
    identity=args.identity or '-'
    if args.identity and not args.identity.startswith('Developer ID Application:'):
        raise SystemExit('Use a Developer ID Application identity for distribution.')
    if args.notary_profile and not args.identity:raise SystemExit('Notarization requires a Developer ID identity.')
    sign=['codesign','--force','--sign',identity]
    if args.identity:sign+=['--timestamp','--options','runtime']
    entitlements=ROOT/'scripts/entitlements.mac.plist'
    fermion_native=app/'Contents/Resources/python/lib/python3.13/site-packages/fermion/_speech/_native_mlx'
    pins=fermion_native/'SHA256SUMS.txt'
    library=fermion_native/'libphonon_mlx-macos-arm64.dylib'
    original_pin=pins.read_text().split()[0]
    if hashlib.sha256(library.read_bytes()).hexdigest()!=original_pin:
        raise SystemExit('Fermion native library does not match its integrity pin. Rebuild before signing.')
    native=[]
    for file in app.rglob('*'):
        if not file.is_file() or file.is_symlink():continue
        with file.open('rb') as stream:magic=stream.read(4)
        if magic in MACHO:native.append(file)
    for file in sorted(native,key=lambda p:len(p.parts),reverse=True):
        run(*sign,'--entitlements',entitlements,file)
    # Signing changes Mach-O bytes, so retain the integrity check with the signed digest.
    signed_pin=hashlib.sha256(library.read_bytes()).hexdigest()
    pins.write_text(f'{signed_pin}  {library.name}\n')
    (fermion_native/'CALL-NOTE-SIGNING-NOTICE.txt').write_text(
        'Call Note distribution modification: Apple code signature applied to the native library.\n'
        f'Pre-signing SHA-256: {original_pin}\nSigned SHA-256: {signed_pin}\n'
        'SHA256SUMS.txt updated to verify the signed binary. Library implementation unchanged.\n')
    bundles=[p for p in app.rglob('*') if p.is_dir() and p.suffix in ('.app','.framework')]
    for bundle in sorted(bundles,key=lambda p:len(p.parts),reverse=True):run(*sign,'--entitlements',entitlements,bundle)
    run(*sign,'--entitlements',entitlements,app)
    run('codesign','--verify','--deep','--strict','--verbose=2',app)
    if args.notary_profile:
        archive=output/f'Call-Note-{version}-notarization.zip'
        run('ditto','-c','-k','--keepParent',app,archive)
        run('xcrun','notarytool','submit',archive,'--keychain-profile',args.notary_profile,'--wait')
        run('xcrun','stapler','staple',app)
        run('spctl','--assess','--type','execute','--verbose=2',app)
    if args.sign_only:return
    if args.notary_profile:
        update_zip=output/f'Call-Note-{version}-macOS-arm64.zip'
        run('ditto','-c','-k','--keepParent',app,update_zip)
        digest=base64.b64encode(hashlib.file_digest(update_zip.open('rb'),'sha512').digest()).decode()
        manifest={'version':version,'files':[{'url':update_zip.name,'sha512':digest,'size':update_zip.stat().st_size}],
                  'path':update_zip.name,'sha512':digest,'releaseDate':datetime.now(timezone.utc).isoformat()}
        (output/'latest-mac.yml').write_text(json.dumps(manifest,indent=2)+'\n')
        (output/(update_zip.name+'.sha256')).write_text(f'{hashlib.file_digest(update_zip.open("rb"),"sha256").hexdigest()}  {update_zip.name}\n')
    staging=ROOT/'.build/dmg-root'
    if staging.exists():shutil.rmtree(staging)
    staging.mkdir(parents=True)
    shutil.copytree(app,staging/app.name,symlinks=True)
    (staging/'Applications').symlink_to('/Applications')
    (staging/'INSTALL.txt').write_text('Call Note '+version+'\n\nDrag Call Note to Applications, then open it there.\nApple Silicon Mac, macOS 14.2 or later.\nPython and the speech model are included; no Homebrew required.\nAllow microphone and system-audio recording when prompted.\n\nUpdates check automatically after launch and every four hours. New versions download in the background and install when you quit. For an optional manual check or restart, use Call Note menu > Check for Updates. Saved calls remain in your user Library.\n')
    suffix='' if args.notary_profile else '-preview'
    dmg=output/f'Call-Note-{version}-macOS-arm64{suffix}.dmg'
    run('hdiutil','create','-volname','Call Note','-srcfolder',staging,'-ov','-format','UDZO',dmg)
    if args.identity:run('codesign','--force','--sign',identity,'--timestamp',dmg)
    if args.notary_profile:
        run('xcrun','notarytool','submit',dmg,'--keychain-profile',args.notary_profile,'--wait')
        run('xcrun','stapler','staple',dmg)
    checksum=hashlib.sha256(dmg.read_bytes()).hexdigest()
    (output/(dmg.name+'.sha256')).write_text(f'{checksum}  {dmg.name}\n')
    print('Release asset:',dmg,'bytes:',dmg.stat().st_size)

if __name__=='__main__':main()
