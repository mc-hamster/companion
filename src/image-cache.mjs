// SPDX-License-Identifier: GPL-3.0-or-later
import { canonicalImageURL, safeImageURL } from './core.mjs';

// No wildcard permission or cookie access. Other hosts retain native loading.
export const IMAGE_CACHE_HOSTS = ['hamsterimg.net','hamster.is','empornium.sx','empornium.me','empornium.is','empornium.ph','emparadise.rs'];
const CACHE_ACTIVITY_KEYS=['hits','misses','downloads','savedBytes','sizedHits'];
const CACHE_ACTIVITY_BUCKET_MS=5000, CACHE_ACTIVITY_HOUR_MS=3600000;
function emptyCacheActivity(pending=false){return{hits:0,misses:0,downloads:0,savedBytes:0,sizedHits:0,recent:pending?new Map():[]};}
function cacheActivityRows(activity){return activity?.recent instanceof Map?[...activity.recent.values()]:activity?.recent||[];}
function mergeCacheActivityRecent(a,b,now){
  const buckets=new Map();
  for(const row of [...cacheActivityRows(a),...cacheActivityRows(b)]){
    if(row[0]+CACHE_ACTIVITY_BUCKET_MS<=now-CACHE_ACTIVITY_HOUR_MS)continue;
    const previous=buckets.get(row[0])||[row[0],0,0,0,0,0];
    for(let i=1;i<=CACHE_ACTIVITY_KEYS.length;i++)previous[i]+=row[i]||0;buckets.set(row[0],previous);
  }
  return [...buckets.values()].sort((a,b)=>a[0]-b[0]).slice(-721);
}
function restoreCacheActivity(target,source,now){
  for(const key of CACHE_ACTIVITY_KEYS)target[key]+=source[key]||0;
  target.recent=new Map(mergeCacheActivityRecent(target,source,now).map(row=>[row[0],row]));
}
export function cacheActivityWindows(activity,now=Date.now()){
  const windows={};
  for(const [key,ms]of[['five',300000],['fifteen',900000],['hour',CACHE_ACTIVITY_HOUR_MS]]){
    const total=emptyCacheActivity();delete total.recent;
    for(const row of cacheActivityRows(activity))if(row[0]<=now&&row[0]+CACHE_ACTIVITY_BUCKET_MS>now-ms){
      CACHE_ACTIVITY_KEYS.forEach((name,i)=>{total[name]+=row[i+1]||0;});
    }
    windows[key]=total;
  }
  windows.all=Object.fromEntries(CACHE_ACTIVITY_KEYS.map(key=>[key,activity?.[key]||0]));return windows;
}
export function cacheBytes(bytes){
  if(bytes>=1024**3)return (bytes/1024**3).toFixed(1)+' GB';
  if(bytes>=1024**2)return (bytes/1024**2).toFixed(1).replace(/\.0$/,'')+' MB';
  if(bytes>=1024)return (bytes/1024).toFixed(1)+' KB';
  return Math.max(0,Math.round(bytes||0))+' B';
}
export class PersistentImageCache {
  constructor(env, settings) {
    this.env=env;this.settings=settings;this.dbPromise=null;this.disabled=false;this.writeBlocked=false;
    this.epoch=0;this.touches=new Map();this.writes=Promise.resolve();this.closed=false;this.nativeOnly=new Set();
    this.activity=emptyCacheActivity();this.listeners=new Set();
    this.pendingActivity=emptyCacheActivity(true);this.activitySequence=0;
    this.activityID=this.env.now()+'-'+Math.random().toString(36).slice(2);
    this.activityGeneration=null;
    try{this.activityChannel=this.env.activityChannel?.();if(this.activityChannel)this.activityChannel.onmessage=e=>this.acceptActivityReset(e.data);}catch{}
  }
  subscribe(listener){this.listeners.add(listener);return()=>this.listeners.delete(listener);}
  notify(){if(!this.closed)for(const listener of this.listeners){try{listener();}catch{}}}
  recordActivity(type,bytes=0){
    const key=type==='hit'?'hits':type==='miss'?'misses':type==='download'?'downloads':null;if(!key||this.closed)return;
    const now=this.env.now(),at=Math.floor(now/CACHE_ACTIVITY_BUCKET_MS)*CACHE_ACTIVITY_BUCKET_MS;
    this.activity[key]++;this.pendingActivity[key]++;this.activitySince??=now;
    let bucket=this.pendingActivity.recent.get(at);
    if(!bucket){bucket=[at,0,0,0,0,0];this.pendingActivity.recent.set(at,bucket);}
    bucket[CACHE_ACTIVITY_KEYS.indexOf(key)+1]++;
    if(type==='hit'&&Number.isSafeInteger(bytes)&&bytes>0){
      this.activity.savedBytes+=bytes;this.pendingActivity.savedBytes+=bytes;bucket[4]+=bytes;
      this.activity.sizedHits++;this.pendingActivity.sizedHits++;bucket[5]++;
    }
    if(this.pendingActivity.recent.size>721)this.pendingActivity.recent=new Map(mergeCacheActivityRecent(this.pendingActivity,null,now).map(row=>[row[0],row]));
    if(!this.dbPromise)void this.open();
    if(!this.activityTimer)this.activityTimer=this.env.setTimeout(()=>{this.activityTimer=null;void this.flushActivity();},500);
    this.notify();
  }
  flushActivity(){
    this.env.clearTimeout(this.activityTimer);this.activityTimer=null;
    if(this.activityReset)return this.activityReset.then(()=>this.flushActivity(),()=>false);
    if(this.activityWrite)return this.activityWrite.then(()=>this.flushActivity());
    if(!CACHE_ACTIVITY_KEYS.some(key=>this.pendingActivity[key]))return Promise.resolve(true);
    if(!this.db)return this.open().then(db=>db?this.flushActivity():false);
    const delta=this.pendingActivity;this.pendingActivity=emptyCacheActivity(true);
    const batch={id:this.activityID+'-'+(++this.activitySequence),...delta,recent:cacheActivityRows(delta),since:this.activitySince,epoch:this.activityGeneration||0};
    this.activityWrite=new Promise(resolve=>{
      let settled=false;
      const failed=()=>{if(settled)return;settled=true;if(batch.epoch===this.activityGeneration)restoreCacheActivity(this.resetDiscard||this.pendingActivity,delta,this.env.now());resolve(false);};
      try{
        // Write-only journaling can commit on pagehide without another JS read
        // callback. The next page can replay it if compaction is interrupted.
        const tx=this.db.transaction('activity','readwrite');tx.objectStore('activity').put(batch);
        tx.oncomplete=()=>{if(!settled){settled=true;resolve(true);}};tx.onerror=tx.onabort=failed;
      }catch{failed();}
    });
    const pending=this.activityWrite;
    pending.then(saved=>{this.activityWrite=null;if(saved){this.activityUnavailable=false;void this.compactActivity();}else this.activityUnavailable=true;});
    return pending;
  }
  compactActivity(){
    if(this.activityCompaction)return this.activityCompaction;
    const pending=(async()=>{
      const db=await this.open();if(!db)return null;
      return new Promise(resolve=>{try{
        const tx=db.transaction(['activity','stats'],'readwrite'),journal=tx.objectStore('activity'),stats=tx.objectStore('stats');
        let total={...emptyCacheActivity(),since:null},epoch=0;
        stats.get('activityEpoch').onsuccess=g=>{epoch=g.target.result||0;stats.get('activityTotals').onsuccess=e=>{
          total=e.target.result||total;
          total.historyPartial ||= total.misses==null&&!!(total.hits||total.downloads);
          for(const key of CACHE_ACTIVITY_KEYS)total[key]??=0;
          total.recent=mergeCacheActivityRecent(total,null,this.env.now());
          const cursor=journal.openCursor();
          cursor.onsuccess=event=>{const c=event.target.result;if(c){
            if((c.value.epoch||0)===epoch){
              total.historyPartial ||= c.value.misses==null&&!!(c.value.hits||c.value.downloads);
              for(const key of CACHE_ACTIVITY_KEYS)total[key]+=(c.value[key]||0);
              total.recent=mergeCacheActivityRecent(total,c.value,this.env.now());
              total.since=total.since==null?c.value.since:Math.min(total.since,c.value.since);}
            c.delete();c.continue();
          }else stats.put(total,'activityTotals');};
        };};
        tx.oncomplete=()=>{this.acceptActivityReset({epoch,since:total.since});resolve({...total,epoch});};tx.onerror=tx.onabort=()=>resolve(null);
      }catch{resolve(null);}});
    })();
    this.activityCompaction=pending;pending.then(()=>{this.activityCompaction=null;});return pending;
  }
  acceptActivityReset(message){
    if(!message||!Number.isSafeInteger(message.epoch)||message.epoch<= (this.activityGeneration??-1))return;
    const previous=this.activityGeneration;this.activityGeneration=message.epoch;
    if(previous!=null){this.pendingActivity=emptyCacheActivity(true);this.activity=emptyCacheActivity();this.activitySince=message.since;
      this.env.clearTimeout(this.activityTimer);this.activityTimer=null;this.notify();}
  }
  resetActivity(){
    if(this.activityReset)return this.activityReset;
    const previous={pending:this.pendingActivity,activity:this.activity,since:this.activitySince,generation:this.activityGeneration};
    this.resetDiscard=previous.pending;this.pendingActivity=emptyCacheActivity(true);this.activity=emptyCacheActivity();this.activitySince=this.env.now();
    this.env.clearTimeout(this.activityTimer);this.activityTimer=null;
    const pending=(async()=>{
      const db=await this.open();if(!db)throw Error('Usage history storage is unavailable.');
      const epoch=await new Promise((resolve,reject)=>{const tx=db.transaction(['activity','stats'],'readwrite'),stats=tx.objectStore('stats');let next;
        stats.get('activityEpoch').onsuccess=e=>{next=(e.target.result||0)+1;tx.objectStore('activity').clear();stats.put(next,'activityEpoch');stats.put({...emptyCacheActivity(),since:this.activitySince},'activityTotals');};
        tx.oncomplete=()=>resolve(next);tx.onerror=tx.onabort=()=>reject(tx.error);
      });
      this.activityGeneration=epoch;this.activityUnavailable=false;
      try{this.activityChannel?.postMessage({epoch,since:this.activitySince});}catch{}
      this.notify();
    })();
    this.activityReset=pending;pending.then(()=>{this.resetDiscard=null;this.activityReset=null;},()=>{
      if(this.activityGeneration===(previous.generation??0)||this.activityGeneration==null&&previous.generation==null){
        restoreCacheActivity(this.pendingActivity,previous.pending,this.env.now());
        for(const key of CACHE_ACTIVITY_KEYS)this.activity[key]+=previous.activity[key];this.activitySince=previous.since;}
      this.resetDiscard=null;this.activityReset=null;
    });return pending;
  }
  isThumbnail(row){return row.kind==='thumbnail'||row.kind==='legacy'&&!!row.tier;}
  adjust(total,row,sign){
    total.bytes=(total.bytes||0)+sign*row.size;total.count=(total.count||0)+sign;
    total.thumbnailBytes=(total.thumbnailBytes||0)+(row.tier?sign*row.size:0);
    total.thumbnailCount=(total.thumbnailCount||0)+(this.isThumbnail(row)?sign:0);
    total.thumbnailFileBytes=(total.thumbnailFileBytes||0)+(this.isThumbnail(row)?sign*row.size:0);
  }
  tier(kind,size){return kind!=='preview'&&size>0&&size<=512*1024?1:0;}
  kind(previous,incoming){return previous==='thumbnail'||incoming==='thumbnail'?'thumbnail':incoming&&incoming!=='legacy'?incoming:previous||incoming||'legacy';}
  enabled(){return !this.closed&&!this.disabled&&!this.displayBlocked&&!!this.env.indexedDB&&this.settings().persistentImages!==false;}
  key(url){return canonicalImageURL(url);}
  allowed(url){
    if(!safeImageURL(url,this.env.origin))return false;
    if(new URL(url).searchParams.getAll('action').some(action=>/^download$/i.test(action)))return false;
    const host=new URL(url).hostname.toLowerCase();
    return IMAGE_CACHE_HOSTS.some(h=>host===h||host.endsWith('.'+h))||this.env.local&&['127.0.0.1','localhost'].includes(host);
  }
  open(){
    if(this.disabled||this.closed||!this.env.indexedDB)return Promise.resolve(null);
    if(this.dbPromise)return this.dbPromise;
    this.dbPromise=new Promise(resolve=>{
      let settled=false,request;
      const finish=db=>{if(settled){db?.close();return;}settled=true;this.env.clearTimeout(timer);this.db=db;resolve(db);};
      const timer=this.env.setTimeout(()=>{this.disabled=true;finish(null);},1500);
      // Fence old writers that cannot preserve saved-byte accounting.
      try{request=this.env.indexedDB.open('empornium-companion-images',6);}catch{this.disabled=true;finish(null);return;}
      request.onupgradeneeded=event=>{
        this.env.clearTimeout(timer);
        const db=request.result;
        if(!db.objectStoreNames.contains('images'))db.createObjectStore('images');
        const meta=db.objectStoreNames.contains('meta')?request.transaction.objectStore('meta'):db.createObjectStore('meta',{keyPath:'url'});
        if(!meta.indexNames.contains('used'))meta.createIndex('used','used');
        if(!meta.indexNames.contains('evict'))meta.createIndex('evict',['tier','used']);
        if(!db.objectStoreNames.contains('stats'))db.createObjectStore('stats');
        if(!db.objectStoreNames.contains('activity'))db.createObjectStore('activity',{keyPath:'id'});
        if(event.oldVersion>=3)return;
        // Upgrade metadata only. Existing image Blobs are never read or cleared.
        const total={bytes:0,count:0,thumbnailBytes:0,thumbnailCount:0,thumbnailFileBytes:0},cursor=meta.openCursor();
        cursor.onsuccess=e=>{const c=e.target.result;if(c){const row=c.value,kind=row.kind||'legacy',tier=this.tier(kind,row.size);
          c.update({...row,kind,tier});this.adjust(total,{...row,kind,tier},1);c.continue();
        }else request.transaction.objectStore('stats').put(total,'total');};
      };
      request.onsuccess=()=>{const db=request.result;if(!['images','meta','stats','activity'].every(s=>db.objectStoreNames.contains(s))){this.disabled=true;db.close();finish(null);return;}db.onversionchange=()=>{void this.flushActivity();db.close();this.db=null;this.disabled=true;};
        try{const tx=db.transaction('stats','readonly');tx.objectStore('stats').get('activityEpoch').onsuccess=e=>{this.activityGeneration=Math.max(this.activityGeneration||0,e.target.result||0);};tx.oncomplete=()=>finish(db);tx.onerror=tx.onabort=()=>finish(db);}catch{finish(db);}};
      request.onerror=request.onblocked=()=>{this.disabled=true;finish(null);};
    });return this.dbPromise;
  }
  async get(url,kind=null){
    const db=await this.open();if(!db)return null;const key=this.key(url);
    return new Promise(resolve=>{let value=null;try{
      const tx=db.transaction('images','readonly');tx.objectStore('images').get(key).onsuccess=e=>{value=e.target.result;};
      tx.oncomplete=()=>{if(value&&value.size>0&&typeof value.slice==='function'){this.touch(key,kind);resolve(value);}else resolve(null);};
      tx.onerror=tx.onabort=()=>resolve(null);
    }catch{resolve(null);}});
  }
  touch(key,kind=null){
    const previous=this.touches.get(key);this.touches.delete(key);this.touches.set(key,{used:this.env.now(),kind:kind?this.kind(previous?.kind,kind):previous?.kind||null});
    if(!this.touchTimer)this.touchTimer=this.env.setTimeout(()=>{this.touchTimer=null;void this.flushTouches();},500);
  }
  async flushTouches(){
    this.env.clearTimeout(this.touchTimer);this.touchTimer=null;
    if(!this.touches.size)return;const touches=this.touches;this.touches=new Map();const db=await this.open();if(!db)return;
    let changed=false;
    await new Promise(resolve=>{try{const tx=db.transaction(['meta','stats'],'readwrite'),store=tx.objectStore('meta'),stats=tx.objectStore('stats');
      stats.get('total').onsuccess=e=>{const total=e.target.result||{bytes:0,count:0,thumbnailBytes:0};let pending=touches.size;
        for(const[key,touch]of touches)store.get(key).onsuccess=event=>{const row=event.target.result;if(row){const kind=this.kind(row.kind,touch.kind),tier=this.tier(kind,row.size);
          const next={...row,used:touch.used,kind,tier};this.adjust(total,row,-1);this.adjust(total,next,1);store.put(next);
          changed ||= kind!==row.kind||tier!==row.tier;
        }if(!--pending)stats.put(total,'total');};
      };
      tx.oncomplete=tx.onerror=tx.onabort=resolve;
    }catch{resolve();}});
    if(changed)this.notify();
  }
  limit(){return (this.settings().persistentCacheMB||512)*1024*1024;}
  async stats(){
    const db=await this.open();if(!db)return{bytes:0,count:0,available:false};
    return new Promise(resolve=>{try{const tx=db.transaction('stats','readonly');let s={bytes:0,count:0};
      tx.objectStore('stats').get('total').onsuccess=e=>{s=e.target.result||s;};tx.oncomplete=()=>resolve({...s,available:true});tx.onerror=tx.onabort=()=>resolve({...s,available:false});
    }catch{resolve({bytes:0,count:0,available:false});}});
  }
  async summary(){
    await this.writes;await this.flushTouches();const flushed=await this.flushActivity(),activity=await this.compactActivity(),stats=await this.stats();
    return {...stats,thumbnailCount:stats.thumbnailCount||0,thumbnailFileBytes:stats.thumbnailFileBytes||0,
      previewCount:Math.max(0,stats.count-(stats.thumbnailCount||0)),previewBytes:Math.max(0,stats.bytes-(stats.thumbnailFileBytes||0)),
      ...Object.fromEntries(CACHE_ACTIVITY_KEYS.map(key=>[key,(activity?.[key]||0)+this.pendingActivity[key]])),
      recent:mergeCacheActivityRecent(activity,this.pendingActivity,this.env.now()),historyPartial:!!activity?.historyPartial,
      activitySince:activity?.since,activityAvailable:!!activity&&flushed,
      limitBytes:this.limit(),saving:this.settings().persistentImages!==false};
  }
  enqueue(work){const pending=this.writes.then(work,work);this.writes=pending.catch(()=>false);return pending;}
  commit(url,blob,epoch=this.epoch,kind='legacy'){
    const thumbnail=this.tier(kind,blob?.size);
    if(!this.enabled()||this.writeBlocked||!thumbnail&&this.previewWriteBlocked||epoch!==this.epoch||!blob?.size||blob.size>this.limit())return Promise.resolve(false);
    return this.enqueue(async()=>{
      if(epoch!==this.epoch||!this.enabled())return false;
      try{const saved=await this.write(url,blob,epoch,kind);this.notify();return saved;}catch(error){
        if(error?.name!=='QuotaExceededError'){this.writeBlocked=true;return false;}
        const s=await this.stats();await this.prune(Math.max(0,s.bytes- Math.max(blob.size*2,s.bytes/4)),{preserveThumbnails:!thumbnail});
        try{const saved=await this.write(url,blob,epoch,kind);this.notify();return saved;}catch{if(thumbnail)this.writeBlocked=true;else this.previewWriteBlocked=true;return false;}
      }
    });
  }
  async write(url,blob,epoch,requestedKind='legacy'){
    const db=await this.open();if(!db||epoch!==this.epoch)return false;const key=this.key(url);
    return new Promise((resolve,reject)=>{try{
      const tx=db.transaction(['images','meta','stats'],'readwrite'),images=tx.objectStore('images'),meta=tx.objectStore('meta'),stats=tx.objectStore('stats');
      let retained=true,total={bytes:0,count:0,thumbnailBytes:0};stats.get('total').onsuccess=e=>{
        total=e.target.result||total;meta.get(key).onsuccess=old=>{
          const previous=old.target.result,kind=this.kind(previous?.kind,requestedKind),tier=this.tier(kind,blob.size);
          const protectedAfter=(total.thumbnailBytes||0)-(previous?.tier?previous.size:0)+(tier?blob.size:0);
          // Reject a large newcomer before evicting anything if it could not
          // fit even after every unprotected file was removed.
          if(!tier&&blob.size>this.limit()-protectedAfter){
            retained=false;
            if(previous){images.delete(key);meta.delete(key);this.adjust(total,previous,-1);stats.put(total,'total');}
            return;
          }
          if(previous)this.adjust(total,previous,-1);
          const next={url:key,size:blob.size,used:this.env.now(),kind,tier};this.adjust(total,next,1);
          images.put(blob,key);meta.put(next);
          const cursor=meta.index('evict').openCursor();cursor.onsuccess=event=>{
            const c=event.target.result;if(c&&(total.bytes>this.limit()||total.count>50000)){
              if(c.value.url===key)retained=false;
              this.adjust(total,c.value,-1);images.delete(c.value.url);c.delete();c.continue();
            }else stats.put(total,'total');
          };
        };
      };
      tx.oncomplete=()=>resolve(retained);tx.onerror=tx.onabort=()=>reject(tx.error||Error('Image cache transaction failed.'));
    }catch(e){reject(e);}});
  }
  async prune(bytes,{preserveThumbnails=false}={}){
    const db=await this.open();if(!db)return;
    await new Promise(resolve=>{try{const tx=db.transaction(['images','meta','stats'],'readwrite'),meta=tx.objectStore('meta'),images=tx.objectStore('images'),stats=tx.objectStore('stats');
      stats.get('total').onsuccess=e=>{const total=e.target.result||{bytes:0,count:0,thumbnailBytes:0};const r=meta.index('evict').openCursor();r.onsuccess=event=>{
        const c=event.target.result;if(c&&total.bytes>bytes&&!(preserveThumbnails&&c.value.tier)){this.adjust(total,c.value,-1);images.delete(c.value.url);c.delete();c.continue();}else stats.put(total,'total');
      };};tx.oncomplete=tx.onerror=tx.onabort=resolve;
    }catch{resolve();}});
    this.notify();
  }
  remove(url){return this.enqueue(async()=>{
    const db=await this.open();if(!db)return;
    await new Promise(resolve=>{try{const tx=db.transaction(['images','meta','stats'],'readwrite'),meta=tx.objectStore('meta'),stats=tx.objectStore('stats'),key=this.key(url);
      meta.get(key).onsuccess=e=>{if(!e.target.result)return;const row=e.target.result;meta.delete(key);tx.objectStore('images').delete(key);stats.get('total').onsuccess=s=>{const t=s.target.result||{bytes:row.size,count:1};this.adjust(t,row,-1);stats.put(t,'total');};};tx.oncomplete=tx.onerror=tx.onabort=resolve;
    }catch{resolve();}});
    this.notify();
  });}
  async clear(){
    this.epoch++;this.touches.clear();this.env.clearTimeout(this.touchTimer);this.touchTimer=null;
    return this.enqueue(async()=>{const db=await this.open();if(!db)throw Error('Browser image storage is unavailable.');
      await new Promise((resolve,reject)=>{const tx=db.transaction(['images','meta','stats'],'readwrite');for(const s of['images','meta'])tx.objectStore(s).clear();tx.objectStore('stats').delete('total');tx.oncomplete=resolve;tx.onerror=tx.onabort=()=>reject(tx.error);});this.writeBlocked=this.previewWriteBlocked=false;this.notify();
    });
  }
  load(url,{network=false,fresh=false,kind='legacy'}={},done){
    let cancelled=false,delivered=false,finishing=false,handle=null;const epoch=this.epoch;const valid=()=>!cancelled&&!this.closed;
    const deliver=result=>{if(valid()&&!delivered){delivered=true;done(result);}};
    const finish=async(blob,hit)=>{
      if(!valid()||delivered||finishing)return;finishing=true;
      const unusable=()=>{if(valid()){if(hit)this.recordActivity('miss');deliver(null);}};
      if(!blob?.size||blob.size>64*1024*1024){unusable();return;}
      try{const dataURL=await this.env.encode(blob);if(valid())deliver({dataURL,blob,hit,epoch,key:this.key(url),kind});}catch{unusable();}
    };
    void(async()=>{
      if(!this.enabled()||!this.allowed(url)||!await this.open()){if(valid())deliver(null);return;}
      if(!fresh){const cached=await this.get(url,kind);if(!valid())return;
        if(cached){await finish(cached,true);return;}this.recordActivity('miss');}
      if(!valid())return;
      const host=new URL(url).host;
      if(!network||!this.env.request||this.writeBlocked||kind==='preview'&&this.previewWriteBlocked||this.nativeOnly.has(host)){deliver(null);return;}
      const fallback=()=>{this.nativeOnly.add(host);if(valid())deliver(null);};
      const transportURL=new URL(url);if(transportURL.protocol==='http:'&&!this.env.local)transportURL.protocol='https:';
      try{handle=this.env.request({method:'GET',url:transportURL.href,anonymous:true,redirect:'error',responseType:'blob',headers:{Referer:this.env.origin+'/'},
        onload:response=>{if(!valid())return;const final=response.finalUrl||transportURL.href;
          if(!this.allowed(final)||!this.env.local&&new URL(final).protocol!=='https:'||[401,403].includes(response.status)){fallback();return;}
          if(response.status<200||response.status>=300){deliver({failure:true,status:response.status});return;}
          if(/^(?:text\/html|application\/json)/i.test(response.response?.type||'')){fallback();return;}
          void finish(response.response,false);
        },onerror:fallback,ontimeout:fallback,onabort:()=>{if(valid())fallback();}});
      }catch{if(valid())deliver(null);}
    })();
    return()=>{cancelled=true;try{handle?.abort?.();}catch{};};
  }
  close(){void this.flushActivity();this.closed=true;this.listeners.clear();this.activityChannel?.close();this.env.clearTimeout(this.touchTimer);this.env.clearTimeout(this.activityTimer);this.dbPromise?.then(db=>db?.close());}
}
