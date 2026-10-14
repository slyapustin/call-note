#import <Foundation/Foundation.h>
#import <CoreAudio/CoreAudio.h>
#import <libproc.h>

enum {maxProcesses=256};

static AudioObjectPropertyAddress propertyAddress(AudioObjectPropertySelector selector) {
    return (AudioObjectPropertyAddress){selector,kAudioObjectPropertyScopeGlobal,kAudioObjectPropertyElementMain};
}

static BOOL readInteger(AudioObjectID object,AudioObjectPropertySelector selector,UInt32 *value) {
    AudioObjectPropertyAddress property=propertyAddress(selector);
    UInt32 size=sizeof(*value);
    return AudioObjectGetPropertyData(object,&property,0,NULL,&size,value)==noErr&&size==sizeof(*value);
}

static NSString *readBundle(AudioObjectID object) {
    AudioObjectPropertyAddress property=propertyAddress(kAudioProcessPropertyBundleID);
    CFStringRef value=NULL;
    UInt32 size=sizeof(value);
    OSStatus status=AudioObjectGetPropertyData(object,&property,0,NULL,&size,&value);
    if(status!=noErr||size!=sizeof(value)||!value)return nil;
    if(CFGetTypeID(value)!=CFStringGetTypeID()){CFRelease(value);return nil;}
    return CFBridgingRelease(value);
}

static NSString *containingApplication(pid_t pid) {
    char executable[PROC_PIDPATHINFO_MAXSIZE]={0};
    if(proc_pidpath(pid,executable,sizeof(executable))<=0)return nil;
    NSString *path=[NSString stringWithUTF8String:executable];
    NSRange app=[path rangeOfString:@".app/Contents/"];
    if(!path||app.location==NSNotFound)return nil;
    return [NSBundle bundleWithPath:[path substringToIndex:app.location+4]].bundleIdentifier;
}

static NSString *canonicalBundle(pid_t pid,NSString *audioBundle) {
    if([audioBundle isEqualToString:@"com.apple.WebKit"]||[audioBundle hasPrefix:@"com.apple.WebKit."])return audioBundle;
    NSString *bundle=containingApplication(pid);
    if(bundle.length)return bundle;
    for(int depth=0;depth<8&&pid>1;depth++) {
        struct proc_bsdinfo info={0};
        if(proc_pidinfo(pid,PROC_PIDTBSDINFO,0,&info,sizeof(info))!=sizeof(info))break;
        if(info.pbi_ppid<=1||(pid_t)info.pbi_ppid==pid)break;
        pid=(pid_t)info.pbi_ppid;
        bundle=containingApplication(pid);
        if(bundle.length)return bundle;
    }
    return audioBundle;
}

static NSArray *snapshot(void) {
    AudioObjectPropertyAddress property=propertyAddress(kAudioHardwarePropertyProcessObjectList);
    if(!AudioObjectHasProperty(kAudioObjectSystemObject,&property))return nil;
    UInt32 size=0;
    if(AudioObjectGetPropertyDataSize(kAudioObjectSystemObject,&property,0,NULL,&size)!=noErr)return nil;
    if(size>maxProcesses*sizeof(AudioObjectID)||size%sizeof(AudioObjectID)!=0)return nil;
    if(size==0)return @[];
    AudioObjectID objects[maxProcesses];
    if(AudioObjectGetPropertyData(kAudioObjectSystemObject,&property,0,NULL,&size,objects)!=noErr)return nil;
    if(size>sizeof(objects)||size%sizeof(AudioObjectID)!=0)return nil;
    NSMutableArray *processes=[NSMutableArray array];
    for(UInt32 i=0;i<size/sizeof(AudioObjectID);i++) {
        UInt32 pid=0,input=0;
        if(!readInteger(objects[i],kAudioProcessPropertyPID,&pid)||!readInteger(objects[i],kAudioProcessPropertyIsRunningInput,&input)||pid>INT32_MAX||input>1)return nil;
        NSString *bundle=readBundle(objects[i]);
        if(!bundle)return nil;
        bundle=canonicalBundle((pid_t)pid,bundle);
        if(bundle.length>255)return nil;
        [processes addObject:@{@"pid":@(pid),@"bundleId":bundle,@"inputActive":input?@YES:@NO}];
    }
    return processes;
}

int main(int argc,const char *argv[]) {
    @autoreleasepool {
        NSArray *processes=nil;
        if(argc==2&&strcmp(argv[1],"--once")==0&&[NSProcessInfo.processInfo isOperatingSystemAtLeastVersion:(NSOperatingSystemVersion){14,2,0}]) {
            processes=snapshot();
            if(!processes)processes=snapshot();
        }
        NSData *json=[NSJSONSerialization dataWithJSONObject:@{@"available":processes?@YES:@NO,@"processes":processes?:@[]} options:NSJSONWritingSortedKeys error:NULL];
        if(!json){fputs("{\"available\":false,\"processes\":[]}\n",stdout);return 1;}
        fwrite(json.bytes,1,json.length,stdout);putchar('\n');
        return processes?0:1;
    }
}
