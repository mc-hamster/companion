// SPDX-License-Identifier: GPL-3.0-or-later
import { setSettingHelp } from './setting-help.mjs';

const legacyLuminanceGroups = new Map([
  ['good', '1a'], ['loved', '1b'], ['performer', '2a'], ['loveperf', '2b'],
  ['newperf', '3a'], ['amateur', '4a'], ['loveamat', '4b'], ['maleperf', '5a'],
  ['lovemale', '5b'], ['likesite', '6a'], ['lovesite', '6b'], ['disliked', '7a'],
  ['hated', '7b'], ['terrible', '7c'], ['useless', '7d']
]);
const luminanceNames = new Map([
  ['1a', 'Liked'], ['1b', 'Loved'], ['2a', 'Performer'], ['2b', 'Loved Performer'],
  ['3a', 'New Performer'], ['3b', 'Loved New Performer'], ['4a', 'Amateur'],
  ['4b', 'Loved Amateur'], ['5a', 'Male Performer'], ['5b', 'Loved Male Performer'],
  ['6a', 'Liked Site'], ['6b', 'Loved Site'], ['7a', 'Disliked'], ['7b', 'Hated'],
  ['7c', 'Blacklisted'], ['7d', 'Useless']
]);
const luminanceWeights = new Map([['verygood', 2], ['good', 1], ['ignore', 0], ['bad', -1], ['verybad', -2]]);
const luminanceDestinations = { favorite: 'Favorite', caution: 'Caution', block: 'Block', collapse: 'Collapse on details', skip: 'Skip' };
const importTagSet = value => new Set(String(value || '').toLocaleLowerCase().split(/\s+/).filter(Boolean));

export function readLuminanceExport(text) {
  if (text.length > 8 * 1024 * 1024) throw new Error('The backup is too large (maximum 8 MiB).');
  let data;
  try { data = JSON.parse(text); }
  catch { throw new Error('Paste the JSON from Luminance’s Export Settings box.'); }
  if (!data?.tags || typeof data.tags !== 'object' || Array.isArray(data.tags)) {
    throw new Error('This export does not contain Luminance tag groups.');
  }
  const groups = [];
  for (const [key, values] of Object.entries(data.tags)) {
    const id = /^Tags([1-6][abc]|7[abcd])$/.exec(key)?.[1] || legacyLuminanceGroups.get(key);
    if (!id) continue;
    const modernKey = 'Tags' + id;
    if (!Array.isArray(values) || values.some(value => typeof value !== 'string')) {
      throw new Error('Invalid tag list in ' + key + '.');
    }
    const tags = new Set();
    for (const value of values) {
      const tag = value.trim().replace(/^📸+\s*/u, '').toLocaleLowerCase();
      if (!tag) continue;
      if (/\s|[\u0000-\u001f\u007f]/u.test(tag)) throw new Error('A tag in ' + key + ' contains spaces or control characters.');
      tags.add(tag);
    }
    if (!tags.size) continue;
    const legacyFlag = 'use' + key[0].toUpperCase() + key.slice(1) + 'Tags';
    const enabled = (data['useTag' + id + 'Tags'] ?? data[legacyFlag]) === true;
    const hiding = id === '7c' && (data.hideTags7cTorrents ?? data.hideTerribleTorrents ?? true) === true;
    const rawWeight = data.tagValues?.[modernKey] ?? data.tagValues?.[key];
    const weight = typeof rawWeight === 'number' ? rawWeight : luminanceWeights.get(rawWeight) ??
      (rawWeight == null ? id[0] === '7' ? -1 : id.endsWith('c') ? 0 : 1 : 0);
    const destination = !enabled || hiding || id === '7d' ? 'skip' : id === '7c' || weight < 0 ? 'caution' :
      weight > 0 ? 'favorite' : 'skip';
    const savedName = data.names?.[key] ?? data.names?.[modernKey];
    const name = typeof savedName === 'string' && savedName.trim() ? savedName.trim().slice(0, 100) : luminanceNames.get(id) || modernKey;
    const note = !enabled ? 'Disabled in Luminance' : hiding ? 'Hid results in Luminance. Choose Block to apply result filtering.' :
      id === '7d' ? 'Collapse on details keeps the tags available under Show other tags on detail pages.' : '';
    groups.push({ id, name, tags: [...tags], destination, note });
  }
  if (!groups.length) throw new Error('No supported Luminance tags were found in this export.');
  return groups;
}

export function planLuminanceImport(groups, choices, settings, nse) {
  const current = {
    favorite: importTagSet(settings.favoriteTags), caution: importTagSet(settings.cautionTags),
    block: importTagSet(nse.nseTaglist), collapse: importTagSet(settings.collapsedDetailTags)
  };
  const allow = importTagSet(nse.nseWhitelist), hardPass = importTagSet(nse.nseHardPassTaglist);
  const requested = { favorite: new Set(), caution: new Set(), block: new Set(), collapse: new Set() };
  for (const [index, group] of groups.entries()) {
    const target = Object.hasOwn(requested, choices[index]) && requested[choices[index]];
    if (target) for (const tag of group.tags) target.add(tag);
  }
  const added = { favorite: [], caution: [], block: [], collapse: [] }, conflicts = new Set();
  for (const [kind, tags] of Object.entries(requested)) for (const tag of tags) {
    if (current[kind].has(tag)) continue;
    const opposite = kind === 'favorite' ? 'caution' : 'favorite';
    if (kind === 'block' ? allow.has(tag) || hardPass.has(tag) :
      kind !== 'collapse' && (current[opposite].has(tag) || requested[opposite].has(tag))) {
      conflicts.add(tag); continue;
    }
    added[kind].push(tag);
  }
  return { added, conflicts: [...conflicts] };
}

export function mountLuminanceImport(app, parent) {
  const panel = app.node('details', null, 'epc-luminance-import');
  panel.dataset.optionItem = '';
  panel.append(setSettingHelp(app.node('summary', 'Import from Luminance'),
    'Bring your tag lists into Companion. You can review what each group will do before anything is applied.'));
  panel.append(app.node('p', 'Copy the JSON from LTH → Import/Export → Export Settings, or choose your saved export.', 'epc-caption'));
  const input = app.node('textarea'); input.rows = 3;
  input.setAttribute('aria-label', 'Luminance export JSON');
  const inputLabel = app.node('label', null, 'epc-field');
  inputLabel.append(setSettingHelp(app.node('span', 'Luminance export JSON'),
    'Paste the settings export you copied from Luminance. Preview import reads the tag groups and shows their suggested destinations.', input), input);
  const file = app.node('input'); file.type = 'file'; file.accept = '.json,.txt,application/json,text/plain';
  file.setAttribute('aria-label', 'Choose Luminance export');
  setSettingHelp(file, 'Open a Luminance JSON or text export and preview its tag groups.');
  const preview = app.node('section', null, 'epc-luminance-preview');
  const status = app.node('p', '', 'epc-caption'); status.setAttribute('role', 'status');
  let groups = [], choices = [], plan, apply;
  const current = () => ({
    settings: { ...app.settings, ...app.storage.get('ep.settings', {}) },
    nse: app.exportData().nse
  });
  const render = () => {
    const { settings, nse } = current();
    plan = planLuminanceImport(groups, choices, settings, nse);
    const { added, conflicts } = plan;
    const counts = Object.entries(added).filter(([, tags]) => tags.length).map(([kind, tags]) => {
      if (kind === 'collapse') return tags.length + (tags.length === 1 ? ' tag' : ' tags') + ' to collapse on details';
      return tags.length + ' ' + luminanceDestinations[kind].toLowerCase() + (tags.length === 1 ? '' : 's');
    });
    status.textContent = (counts.length ? 'To add · ' + counts.join(' · ') : 'No new tags to add') +
      (conflicts.length ? ' · ' + conflicts.length + (conflicts.length === 1 ? ' conflict skipped' : ' conflicts skipped') : '');
    apply.disabled = !Object.values(added).some(tags => tags.length);
    const conflictList = preview.querySelector('.epc-luminance-conflicts');
    conflictList.textContent = conflicts.length ? 'Conflicts kept as-is · ' + conflicts.join(', ') : '';
    preview.querySelector('.epc-luminance-block-note').hidden = !added.block.length;
  };
  const analyze = () => {
    preview.replaceChildren();
    try {
      groups = readLuminanceExport(input.value); choices = groups.map(group => group.destination);
      preview.append(app.node('h3', 'Review tag groups'));
      for (const [index, group] of groups.entries()) {
        const row = app.node('div', null, 'epc-luminance-group');
        const tags = app.node('details');
        const heading = app.node('summary', group.name + ' · ' + group.tags.length);
        tags.append(heading,
          app.node('p', group.tags.join(' '), 'epc-luminance-tags'));
        if (group.note) tags.append(app.node('p', group.note, 'epc-caption'));
        const select = app.node('select');
        select.setAttribute('aria-label', 'Destination for ' + group.name);
        setSettingHelp(heading, 'Open to inspect the tags. Use the adjacent menu to choose how Companion treats this group.', select);
        for (const [value, label] of Object.entries(luminanceDestinations)) {
          if (value === 'collapse' && group.id !== '7d') continue;
          const option = app.node('option', label); option.value = value; select.append(option);
        }
        select.value = choices[index];
        select.addEventListener('change', () => { choices[index] = select.value; render(); });
        row.append(tags, select); preview.append(row);
      }
      preview.append(app.node('p', 'Skipped settings include styles, scores, size indicators, and layout.', 'epc-caption'),
        app.node('p', '', 'epc-caption epc-luminance-conflicts'),
        app.node('p', 'Block hides matching results under Companion’s regular rules and page coverage.', 'epc-caption epc-luminance-block-note'));
      apply = app.button('Import selected tags', () => {
        if (!app.preferences.flush()) return;
        const reviewed = JSON.stringify(plan);
        render();
        if (reviewed !== JSON.stringify(plan)) {
          status.textContent += ' · Preferences changed. Review these counts and click Import again.';
          return;
        }
        const { settings, nse } = current(), { added } = plan;
        const merge = (old, tags) => [String(old || '').trim(), ...tags].filter(Boolean).join(' ');
        const snapshot = {
          format: 'empornium-companion', version: 1,
          settings: { ...settings, favoriteTags: merge(settings.favoriteTags, added.favorite),
            cautionTags: merge(settings.cautionTags, added.caution),
            collapsedDetailTags: merge(settings.collapsedDetailTags, added.collapse) },
          nse: added.block.length ? { nseTaglist: merge(nse.nseTaglist, added.block) } : {}
        };
        try {
          app.importData(JSON.stringify(snapshot), false, { mergePreferences: true });
          status.textContent = 'Tags imported. You can use Undo changes to reverse the import. Disable Luminance and reload after reviewing your tags.';
          preview.replaceChildren();
        } catch (error) { status.textContent = 'Nothing imported · ' + error.message; }
      });
      preview.append(setSettingHelp(apply, 'Merge the selected tags into your preferences. Undo changes can reverse the import.'));
      render();
    } catch (error) { status.textContent = error.message; }
  };
  input.addEventListener('input', () => { preview.replaceChildren(); status.textContent = ''; });
  file.addEventListener('change', async () => {
    const picked = file.files?.[0];
    if (!picked) return;
    try {
      if (picked.size > 8 * 1024 * 1024) throw new Error('The backup is too large (maximum 8 MiB).');
      input.value = await app.readFile(picked); analyze();
    } catch (error) { status.textContent = error.message; }
    finally { file.value = ''; }
  });
  panel.append(inputLabel, setSettingHelp(app.button('Preview import', analyze),
    'Review detected tag groups, suggested mappings, and conflicts before importing.'), file, status, preview);
  parent.append(panel);
}
