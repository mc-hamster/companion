import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { JSDOM } from 'jsdom';
import { qaCases } from '../test/qa-cases.mjs';
import { qaCoverage } from '../test/qa-coverage.mjs';
const path = new URL('../docs/qa-progress.json',import.meta.url);
export async function readQA() { return JSON.parse(await readFile(path,'utf8')); }
export async function writeQA(data) {
  data.updatedAt = new Date().toISOString();
  await writeFile(path,JSON.stringify(data,null,2)+'\n');
  const escape = value => String(value || '').replace(/\|/g,'\\|').replace(/\n/g,' ');
  const status = item => [item.automation,item.browser].filter(lane=>lane.status!=='not applicable').some(lane=>lane.status==='failed')?'FAIL':
    [item.automation,item.browser].filter(lane=>lane.status!=='not applicable').every(lane=>lane.status==='passed')?'PASS':'PENDING';
  let md = '# Acceptance test matrix\n\nUpdated '+data.updatedAt+'. Artifact '+data.artifact.version+' (`'+data.artifact.sha256.slice(0,16)+'`).\n\n'+
    'Automated and browser lanes are independent. PASS requires every applicable lane to pass. Existing automated tests are listed separately in the live progress panel; they do not imply a browser/extension pass.\n\n';
  for (const area of [...new Set(data.cases.map(item=>item.area))]) {
    md+='## '+area+'\n\n| ID / priority | Preconditions | Steps | Expected | Automation | Browser | Overall |\n| --- | --- | --- | --- | --- | --- | --- |\n';
    for(const item of data.cases.filter(item=>item.area===area)) md+='| '+[item.id+' / '+item.priority,item.context,item.steps,item.expected,item.automation.status,item.browser.status,status(item)].map(escape).join(' | ')+' |\n';
    md+='\n';
  }
  md+='## Evidence and notes\n\n';
  for(const item of data.cases) if(item.notes.length||item.automation.evidence.length||item.browser.evidence.length) md+='- **'+item.id+'**: '+[...item.notes,...item.automation.evidence,...item.browser.evidence].map(escape).join(' · ')+'\n';
  await writeFile(new URL('../docs/TEST-MATRIX.md',import.meta.url),md);
}
export async function updateCase(id,lane,status,note) {
  const data=await readQA(), item=data.cases.find(item=>item.id===id); if(!item)throw Error('Unknown case '+id);
  item[lane].status=status;item[lane].artifactSha=data.artifact.sha256;if(note)item[lane].evidence.push(note);
  data.activity.unshift({time:new Date().toISOString(),text:id+': '+status+(note?' — '+note:'')}); data.activity=data.activity.slice(0,100);
  await writeQA(data);
}
export async function importJUnit(file,label='Current automated run') {
  const data=await readQA(), dom=new JSDOM(await readFile(file,'utf8'),{contentType:'text/xml'});
  const artifact=await readFile(new URL('../dist/EmporniumCompanion.user.js',import.meta.url));
  const previousSha=data.artifact.sha256;
  data.artifact={version:JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8')).version,
    sha256:createHash('sha256').update(artifact).digest('hex')};
  const latest=[...dom.window.document.querySelectorAll('testcase')].map(item=>({name:item.getAttribute('name'),file:item.getAttribute('file'),
    status:item.querySelector('failure,error')?'failed':item.querySelector('skipped')?'not run':'passed',
    details:item.querySelector('failure,error')?.textContent || '',seconds:Number(item.getAttribute('time')||0)}));
  const sameArtifact=previousSha===data.artifact.sha256;
  if(!sameArtifact)for(const item of data.cases){if(item.automation.status!=='not applicable'){item.automation.status='not run';item.automation.evidence=[];}if(item.browser.status==='passed') {item.notes.push('Earlier browser pass belongs to '+previousSha.slice(0,12)+'; retest required for the new artifact.');item.browser.status='not run';}}
  const merged=new Map((sameArtifact?data.automation.tests:[]).map(test=>[test.name,test]));for(const test of latest)merged.set(test.name,test);const tests=[...merged.values()];
  dom.window.close();data.automation={label,latestCount:latest.length,tests,passed:tests.filter(t=>t.status==='passed').length,failed:tests.filter(t=>t.status==='failed').length};
  data.runs ||= [];data.runs.push({label,artifact:data.artifact,passed:data.automation.passed,failed:data.automation.failed,time:new Date().toISOString()});
  for(const item of data.cases) {
    const refs=qaCoverage[item.id]||[], explicit=tests.filter(test=>test.name.includes('['+item.id+']'));
    const matches=[...new Set([...explicit,...tests.filter(test=>refs.some(ref=>test.name.includes(ref)))])];
    if(matches.some(test=>test.status==='failed')){item.automation.status='failed';item.automation.evidence=matches.map(test=>test.name);}
    else if((refs.length&&refs.every(ref=>tests.some(test=>test.name.includes(ref))))||!refs.length&&explicit.length){item.automation.status=matches.every(test=>test.status==='passed')?'passed':'not run';item.automation.evidence=matches.map(test=>test.name);item.automation.artifactSha=data.artifact.sha256;}
  }
  data.activity.unshift({time:new Date().toISOString(),text:label+': '+data.automation.passed+' passed, '+data.automation.failed+' failed'});
  await writeQA(data);
}
if(process.argv[2]==='init') {
  const artifact=await readFile(new URL('../dist/EmporniumCompanion.user.js',import.meta.url));
  const version=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8')).version;
  await mkdir(new URL('../docs/',import.meta.url),{recursive:true});
  await writeQA({title:'Empornium Companion quality audit',phase:'Audit in progress',focus:'Baseline and acceptance coverage',
    artifact:{version,sha256:createHash('sha256').update(artifact).digest('hex')},startedAt:new Date().toISOString(),
    environments:[{name:'Node + jsdom',status:'Available; automated model/bundle checks'},
      {name:'In-app Chromium',status:'Available; real browser, mock persistent GM APIs'},
      {name:'Chrome + Tampermonkey',status:'Not connected; manager sandbox unverified'},
      {name:'Firefox + manager',status:'Not connected; unverified'}],cases:qaCases,automation:{label:'Not run',tests:[]},activity:[]});
}
if(process.argv[2]==='junit') await importJUnit(process.argv[3],process.argv[4]);
