const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function helperFixture({title='Draft title',eventId='meeting-1',refresh,error}={}) {
  const controls={title:{value:title},'calendar-events':{value:''}};
  const events=[{id:eventId,title:'Updated meeting'}];
  const notices=[];
  const context=vm.createContext({
    $:id=>controls[id],
    selectedEvent:{id:eventId,title:'Old meeting'},
    calendarEvents:events,
    refreshCalendar:async()=>{if(error)throw error;await refresh?.(context,events);},
    notice:message=>notices.push(message),
  });
  const source=fs.readFileSync(path.join(__dirname,'ui/app.js'),'utf8');
  const start=source.indexOf('async function refreshCalendarPreservingDraft()');
  const end=source.indexOf('\n}',start)+2;
  vm.runInContext(source.slice(start,end)+'\nthis.refreshCalendarPreservingDraft=refreshCalendarPreservingDraft;',context);
  return {context,controls,events,notices};
}

test('calendar refresh preserves a typed call title and rebinds the selected meeting',async()=>{
  const f=helperFixture({refresh:(_context,events)=>{events[0]={id:'meeting-1',title:'Renamed meeting'};}});
  await f.context.refreshCalendarPreservingDraft();
  assert.equal(f.controls.title.value,'Draft title');
  assert.equal(f.context.selectedEvent.title,'Renamed meeting');
  assert.equal(f.controls['calendar-events'].value,'meeting-1');
});

test('calendar refresh failure leaves the typed title and drops a stale meeting selection',async()=>{
  const f=helperFixture({error:Error('Calendar unavailable')});
  f.events.length=0;
  await f.context.refreshCalendarPreservingDraft();
  assert.equal(f.controls.title.value,'Draft title');
  assert.equal(f.context.selectedEvent,null);
  assert.equal(f.controls['calendar-events'].value,'');
  assert.deepEqual(f.notices,['Calendar could not refresh: Calendar unavailable']);
});
