// SPDX-License-Identifier: GPL-3.0-or-later
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { IMAGE_CACHE_HOSTS } from '../src/image-cache.mjs';

const root = new URL('../', import.meta.url);
const read = path => readFile(new URL(path, root), 'utf8');
const packageInfo = JSON.parse(await read('package.json'));
const releaseVersion = packageInfo.version;
const repository = /^git\+https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\.git$/.exec(packageInfo.repository?.url || '')?.[1];
if (!repository) throw new Error('A GitHub repository URL is required for install and update links.');
const repositoryURL = 'https://github.com/' + repository;
const downloadBase = 'https://raw.githubusercontent.com/' + repository + '/main/dist/';
if (!/^\d+\.\d+\.\d+$/.test(releaseVersion)) throw new Error('Invalid release version.');
const upstream = await read('vendor/noshitempornium/NoShitEmpornium.user.js');
const expectedHash = '75fd5dff4919ba07a3e7135a9ab86fb764cd427e';
const actualHash = createHash('sha1').update('blob ' + Buffer.byteLength(upstream) + '\0').update(upstream).digest('hex');
if (actualHash !== expectedHash) throw new Error('NSE reference changed; review build transformations before updating its hash.');
const backfillReference = await read('vendor/noshitempornium-backfill/NoShitEmpornium.user.js');
const backfillHash = createHash('sha1').update('blob ' + Buffer.byteLength(backfillReference) + '\0').update(backfillReference).digest('hex');
if (backfillHash !== '62112c76ea18bde028ac055688475991569f02c4') throw new Error('Backfill reference changed; review its integration before updating the hash.');
let nse = upstream.slice(upstream.indexOf('// Copyright'));
const replace = (from, to) => {
  if (!nse.includes(from)) throw new Error('NSE integration anchor missing: ' + from.slice(0, 90));
  nse = nse.replace(from, to);
};
const section = (start, end, replacement) => {
  const a = nse.indexOf(start), b = nse.indexOf(end, a + start.length);
  if (a < 0 || b < 0) throw new Error('NSE section anchor missing: ' + start);
  nse = nse.slice(0, a) + replacement(nse.slice(a, b)) + nse.slice(b);
};
// Derive an import schema from declared defaults; never execute the reference at build time.
const schema = {};
const readers = [];
const readerNames = {};
const initialization = upstream.slice(0, upstream.indexOf('// | Script setup and preparation |'));
for (const match of initialization.matchAll(/let (\w+) = GM_getValue\("(nse\w+)",\s*/g)) {
  let position = match.index + match[0].length, depth = 1, quote = null, escaped = false;
  const start = position;
  for (; position < initialization.length; position++) {
    const c = initialization[position];
    if (quote) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) break;
  }
  if (depth) throw new Error('Unbalanced setting reader.');
  readers.push(match[1] + ' = GM_getValue(' + JSON.stringify(match[2]) + ', ' + initialization.slice(start, position) + ');');
  readerNames[match[2]] = match[1];
}
for (const match of upstream.matchAll(/GM_getValue\("(nse\w+)",\s*([^\n]+)/g)) {
  const value = match[2];
  schema[match[1]] = /^(true|false)\b/.test(value) ? 'boolean' : /^new Array/.test(value) ? 'array' :
    /^\{/.test(value) ? 'object' : /^"/.test(value) ? 'string' : 'number';
}
replace('throw "Note: NSE died on the way back to his home planet (referenceNode is null)";',
  'referenceNode = document.querySelector("#search_form,.linkbox,#content h2");\n    if (!referenceNode) { app.report("Filtering controls could not find a page anchor."); return; }');
section('htmlContent.innerHTML =', 'referenceNode.after(htmlContent);', html =>
  html.replace(/\$\{(nse(?:BlacklistTaglist|HardPassTaglist|WhitelistTaglist|BlacklistTitleList|HardPassTitleList|WhitelistTitleList|BlacklistUploadersList|WhitelistUploadersList|UIFont|TextAreaFont|BlacklistColor|HardPassColor|WhitelistColor)|nseCustomTheme\.\w+)\}/g, (_, expression) => '${escapeHTML(' + expression + ')}')
    .replace(/\$\{(nseCustomCSS\.replace\([^\n]+?)\}/g, (_, expression) => '${escapeHTML(' + expression + ')}'));
nse = nse.replace(/\$\{(currentTBLPhrase|currentTWLPhrase)\}/g, (_, expression) => '${escapeHTML(' + expression + ')}');
section('if(torrents) {', '// +-----------------------------------------+\n// | Event handler assignment', block =>
  'let epIconSequence = 0;\nfunction epFilterRows(torrents) {\napp.captureFilterBaseline();\n' + block + '\n}\nepFilterRows(torrents);\n\n');
replace('id="nseToggleIcon_${i}"', 'id="nseToggleIcon_${++epIconSequence}"');
section('// Assign event handlers if arrow key navigation is enabled', 'let headerNode =', () => '');
section('let nseTextAreas =', 'let explanationTogglers =', () => '');
const eventStart = nse.indexOf('let explanationTogglers =');
const rcmStart = nse.indexOf('if(nseRightClickManagementEnabled', eventStart);
const rcmEnd = nse.indexOf('document.getElementById("nseExportButton").onclick', rcmStart);
if (rcmStart < 0 || rcmEnd < 0) throw new Error('Missing RCM anchor.');
nse = nse.slice(0, rcmStart) + await read('src/nse-contextmenu.inc.js') + '\n' + nse.slice(rcmEnd);
replace('function () { importSettings(event); }', 'function (event) { importSettings(event); }');
section('function importSettings(event) {', 'function resetSettings() {', () =>
  'async function importSettings(event) {\n' +
  ' const file = event.target.files && event.target.files[0]; if (!file) return;\n' +
  ' try { if(file.size > 8388608) throw new Error("Backup exceeds 8 MiB.");\n' +
  ' app.importData(await app.readFile(file)); app.toast("Import complete. Reload to apply filters.");\n' +
  ' } catch(error) { app.toast("Nothing imported: " + error.message); }\n' +
  ' event.target.value = "";\n}\n\n');
nse = nse.replace(/(getElementById\("nseRCMBox(?:Tag|Uploader)"\))\.innerHTML/g, '$1.textContent');
nse = nse.replace(/\+ elementValue \+/g, '+ escapeHTML(elementValue) +');
// Title values live in an input attribute in the RCM template.
nse = nse.replace(/elementValue\.replace\(\/"\/g, '&quot;'\)/g, 'escapeHTML(elementValue)');
replace('document.getElementById("nseRCMBoxHPTAdd").onclick =', 'if(document.getElementById("nseRCMBoxHPTAdd")) document.getElementById("nseRCMBoxHPTAdd").onclick =');
nse = nse.replace(/mObserver\.observe\(currTaglist, observerOptions\);/g, 'if(currTaglist) mObserver.observe(currTaglist, observerOptions);');
nse = nse.replace(/titleElement\.classList\.add\("nseTitleElement"\);/g, 'if(titleElement) titleElement.classList.add("nseTitleElement");');
replace('\np:not(:last-child) {', '\n#nseOuter p:not(:last-child) {');
replace('\nsection {', '\n#nseOuter section {');
replace('width: 600px;', 'width: min(600px, 100%); box-sizing: border-box;');
replace('bottom: 2em;\n    right: 2em;', 'bottom: 72px;\n    right: 16px;');
replace('elementsToRemove[i].remove();', 'app.detachFilteredRow(elementsToRemove[i]);');
replace('referenceNode.after(htmlContent);', 'htmlContent.hidden = true; htmlContent.classList.add("epc-engine"); referenceNode.after(htmlContent);');
replace('storedList = [...new Set(storedList)];', 'storedList = [...new Set(storedList.filter(item => item.trim()))];');
nse = nse.replace(/document\.getElementById\("nseOuter"\)\.scrollIntoView\(\);/g, 'app.root?.scrollIntoView({block:"start"});');
nse = nse.replace(/a\.nseTitleElement/g, "a[href*='torrents.php?id=']");
nse = nse.replaceAll('"Filter this torrent with NSE"', '"Change result visibility"');
nse = nse.replaceAll('<i class="font_icon torrent_icons clickable">', '<i class="font_icon torrent_icons clickable nseToggleIcon">');
replace('Are you sure you want to reset all blacklists, all whitelists, and all preferences in NSE? This cannot be undone!',
  'Reset all filter lists, individual visibility overrides, and filter preferences? Saved searches and image preferences will be kept.');
nse = nse.replaceAll('nseExport-', 'empornium-filters-');
replace('function saveData() {', 'function saveData() {\n    app.beforeFilterWrite();');
replace('document.getElementById("nseSaveDiv").classList.remove("hidden");',
  'document.getElementById("nseSaveDiv").classList.remove("hidden");\n    app.afterFilterWrite();');
replace('seeders.innerHTML = "(0)";', '');
replace('seedersElement.innerHTML = "(" + seedersElement.innerHTML + ")";', '');
replace('seedersElement2.innerHTML = "(0)";', '');
section('        let h2textChild =', '        // Scan title for nseBlacklistTitlePhrases', () =>
  '        let newSpan = titleElement.querySelector("[data-ep-detail-title]");\n' +
  '        if(!newSpan) {\n' +
  '            const text = Array.from(titleElement.childNodes).find(n => n.nodeType === 3 && n.textContent.trim());\n' +
  '            newSpan = document.createElement("span"); newSpan.dataset.epDetailTitle = "";\n' +
  '            if(text) { text.after(newSpan); newSpan.append(text); } else titleElement.append(newSpan);\n' +
  '        }\n        titleElement = newSpan;\n\n');
const customCSSExpression = '$' + "{nseCustomCSSEnabled ? nseCustomCSS : ''}";
replace(customCSSExpression, '');
nse += '\n' + await read('src/nse-dynamic.inc.js');
const controls = {};
for (const objectName of ['listsToSave','checkboxes']) {
  const body = upstream.match(new RegExp('let ' + objectName + ' = \\{([\\s\\S]*?)\\};'))?.[1];
  if (!body) throw new Error('Missing filter control mapping.');
  for (const match of body.matchAll(/(nse\w+): "(nse\w+)"/g)) controls[match[1]] = match[2];
}
Object.assign(controls, { nseSelectedTheme:'nseThemeDropdown', nseUIFont:'nseUIFont',
  nseTextAreaFont:'nseTextAreaFont', nseBlacklistColor:'nseBlacklistColor',
  nseHardPassColor:'nseHardPassColor', nseWhitelistColor:'nseWhitelistColor',
  nseTimeout:'nseTimeout', nseCustomCSS:'nseCustomCSSArea', nseEveryDayIsApril1st:'nseCheckApril1stAllYear' });
if (readers.length !== Object.keys(schema).length) throw new Error('Incomplete live setting readers.');
nse += '\n' + (await read('src/nse-live.inc.js'))
  .replace('/*FILTER_READERS*/', () => readers.join('\n    '))
  .replace('/*FILTER_VALUES*/', () => '{' + Object.entries(readerNames).map(([key,value]) => JSON.stringify(key) + ':' + value).join(',') + '}')
  .replaceAll('/*FILTER_CONTROLS*/', () => JSON.stringify(controls));

const stripExports = text => text.replace(/^export /gm, '');
const core = stripExports(await read('src/core.mjs'));
const app = stripExports((await read('src/app.mjs')).replace(/import \{[\s\S]*?\} from '\.\/[^']+';\n/g, ''));
const workspace = stripExports(await read('src/workspace.mjs'));
const preferences = stripExports((await read('src/preferences.mjs')).replace(/import \{[\s\S]*?\} from '\.\/[^']+';\n/g, ''));
const backfill = stripExports((await read('src/backfill.mjs')).replace(/import \{[\s\S]*?\} from '\.\/[^']+';\n/g, ''));
const onboarding = stripExports((await read('src/onboarding.mjs')).replace(/import \{[\s\S]*?\} from '\.\/[^']+';\n/g, ''));
const imageCache = stripExports((await read('src/image-cache.mjs')).replace(/import \{[\s\S]*?\} from '\.\/[^']+';\n/g, ''));
const searchEditor = stripExports((await read('src/search-editor.mjs')).replace(/import \{[\s\S]*?\} from '\.\/[^']+';\n/g, ''));
const resultTools = stripExports(await read('src/result-tools.mjs'));
const gridView = stripExports((await read('src/grid-view.mjs')).replace(/import \{[\s\S]*?\} from '\.\/[^']+';\n/g, ''));
const scheduling = stripExports(await read('src/scheduling.mjs'));
const settings = stripExports(await read('src/nse-settings.mjs'));
const css = await read('src/companion.css');
const header = [
  '// ==UserScript==',
  '// @name         Empornium Companion',
  '// @namespace    empornium-companion.local',
  '// @version      ' + releaseVersion,
  '// @homepageURL  ' + packageInfo.homepage,
  '// @supportURL   ' + repositoryURL + '/issues',
  '// @source       ' + repositoryURL,
  '// @updateURL    ' + downloadBase + 'EmporniumCompanion.meta.js',
  '// @downloadURL  ' + downloadBase + 'EmporniumCompanion.user.js',
  '// @description  Reliable images, alternate versions, tag highlights, filters, and saved searches.',
  '// @author       Empornium Companion contributors; filtering engine by ceodoe',
  '// @license      GPL-3.0-or-later',
  ...['empornium.sx','empornium.me','empornium.is','empornium.ph','emparadise.rs'].flatMap(host =>
    ['// @match        https://' + host + '/*', '// @match        https://www.' + host + '/*']),
  '// @run-at       document-start',
  '// @noframes',
  ...['GM_getValue','GM_setValue','GM_listValues','GM_deleteValue','GM_addStyle','GM_registerMenuCommand','GM_xmlhttpRequest'].map(grant => '// @grant        ' + grant),
  ...IMAGE_CACHE_HOSTS.map(host => '// @connect      ' + host),
  '// ==/UserScript=='
].join('\n');
const bootstrap = (await read('src/bootstrap.inc.js'))
  .replace('/*NSE_SCHEMA*/', JSON.stringify(schema))
  .replace('/*COMPANION_CSS*/', JSON.stringify(css))
  .replace('/*NSE_BODY*/', nse);
await mkdir(new URL('dist/', root), { recursive: true });
const artifact = header + '\n\n(function () {\n"use strict";\n' + core + '\n' + imageCache + '\n' + preferences + '\n' + backfill + '\n' + onboarding + '\n' + searchEditor + '\n' + resultTools + '\n' + gridView + '\n' + scheduling + '\n' + workspace + '\n' + app + '\n' + settings + '\n' + bootstrap + '\n})();\n';
await writeFile(new URL('dist/EmporniumCompanion.meta.js', root), header + '\n');
await writeFile(new URL('dist/EmporniumCompanion.user.js', root), artifact);
await writeFile(new URL('dist/EmporniumCompanion-' + releaseVersion + '.user.js', root), artifact);
await writeFile(new URL('dist/nse-schema.json', root), JSON.stringify(schema, null, 2) + '\n');
console.log('Built Empornium Companion; ' + Object.keys(schema).length + ' validated filter preferences.');
