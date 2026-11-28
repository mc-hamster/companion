// SPDX-License-Identifier: GPL-3.0-or-later
import { tagCategoriesWithTags, tagCategorySettings, tagListTokens } from './core.mjs';
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
const luminanceHighlightCategories = new Map([
  ['1a', 'favorite'], ['1b', 'loved'], ['2a', 'liked-performer'], ['2b', 'loved-performer'],
  ['3a', 'new-performer'], ['6a', 'liked-site'], ['6b', 'loved-site']
]);
const luminanceActions = new Map([['block', 'Block'], ['collapse', 'Collapse on details'], ['skip', 'Skip']]);

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
    const negativeHighlight = id === '7b' ? 'hated' : 'caution';
    const destination = !enabled || hiding || id === '7d' ? 'skip' : id === '7c' || weight < 0 ? negativeHighlight :
      weight > 0 ? luminanceHighlightCategories.get(id) ?? 'favorite' : 'skip';
    const savedName = data.names?.[key] ?? data.names?.[modernKey];
    const name = typeof savedName === 'string' && savedName.trim() ? savedName.trim().slice(0, 100) : luminanceNames.get(id) || modernKey;
    const note = !enabled ? 'Disabled in Luminance' : hiding ? 'Hid results in Luminance. Choose Block to apply result filtering.' :
      id === '7d' ? 'Collapse on details keeps the tags available under Show other tags on detail pages.' : '';
    groups.push({ id, name, tags: [...tags], destination, note });
  }
  if (!groups.length) throw new Error('No supported Luminance tags were found in this export.');
  return groups;
}

export function planLuminanceImport(groups, choices, settings, nse, moveExisting = false) {
  const categories = tagCategoriesWithTags(settings);
  const destinations = [...categories.map(group => group.id), 'block', 'collapse'];
  const requested = new Map(destinations.map(id => [id, new Set()]));
  for (const [index, group] of groups.entries()) {
    const target = requested.get(choices[index]);
    if (target) for (const tag of group.tags) target.add(tag);
  }
  const added = Object.fromEntries(destinations.map(id => [id, []]));
  const conflicts = new Set(), assigned = new Map(), targets = new Map(), moves = [];
  for (const { id, tags } of categories) {
    for (const tag of tagListTokens(tags)) assigned.set(tag, id);
    for (const tag of requested.get(id)) {
      if (targets.has(tag)) conflicts.add(tag);
      else targets.set(tag, id);
    }
  }
  for (const [tag, id] of targets) {
    const owner = assigned.get(tag);
    if (owner === id || conflicts.has(tag)) continue;
    if (owner) {
      moves.push({ tag, from: owner });
      if (!moveExisting) { conflicts.add(tag); continue; }
    }
    added[id].push(tag);
  }
  const blocked = new Set(tagListTokens(nse.nseTaglist));
  const allow = new Set(tagListTokens(nse.nseWhitelist)), hardPass = new Set(tagListTokens(nse.nseHardPassTaglist));
  for (const tag of requested.get('block')) {
    if (blocked.has(tag)) continue;
    if (allow.has(tag) || hardPass.has(tag)) conflicts.add(tag);
    else added.block.push(tag);
  }
  const collapsed = new Set(tagListTokens(settings.collapsedDetailTags));
  added.collapse = [...requested.get('collapse')].filter(tag => !collapsed.has(tag));
  return { added, conflicts: [...conflicts], moves };
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
  const moveExisting = app.node('input'); moveExisting.type = 'checkbox';
  const moveLabel = app.node('label', null, 'epc-check');
  moveLabel.append(moveExisting, app.node('span', 'Move existing highlights to the selected categories'));
  let groups = [], selects = [], optionSignature, plan, apply;
  const render = ({ settings, nse } = app.exportData()) => {
    const labels = new Map(settings.tagCategories.map(group => [group.id, group.name + (group.enabled ? '' : ' (disabled)')]));
    const signature = JSON.stringify([...labels]);
    if (signature !== optionSignature) {
      for (const [index, select] of selects.entries()) {
        const choice = select.value || groups[index].destination;
        const categoryOptions = app.node('optgroup'); categoryOptions.label = 'Highlight categories';
        const option = (value, label) => {
          const node = app.node('option', label); node.value = value; return node;
        };
        for (const [id, label] of labels) categoryOptions.append(option(id, label));
        select.replaceChildren(categoryOptions);
        for (const [id, label] of luminanceActions) {
          if (id !== 'collapse' || groups[index].id === '7d') select.append(option(id, label));
        }
        select.value = choice;
        if (!select.value) select.value = 'skip';
      }
      optionSignature = signature;
    }
    plan = planLuminanceImport(groups, selects.map(select => select.value), settings, nse, moveExisting.checked);
    const { added, conflicts, moves } = plan;
    const counts = Object.entries(added).filter(([, tags]) => tags.length)
      .map(([id, tags]) => (labels.get(id) || luminanceActions.get(id)) + ' (' + tags.length + ')');
    status.textContent = (counts.length ? 'To import · ' + counts.join(', ') : 'No new tags to import') +
      (moveExisting.checked && moves.length ? ' · ' + moves.length + (moves.length === 1 ? ' existing highlight will move' : ' existing highlights will move') : '') +
      (conflicts.length ? ' · ' + conflicts.length + (conflicts.length === 1 ? ' conflict skipped' : ' conflicts skipped') : '');
    moveLabel.hidden = !moves.length;
    apply.disabled = !Object.values(added).some(tags => tags.length);
    const conflictList = preview.querySelector('.epc-luminance-conflicts');
    conflictList.textContent = conflicts.length ? 'Conflicts kept as-is · ' + conflicts.join(', ') : '';
    preview.querySelector('.epc-luminance-block-note').hidden = !added.block.length;
  };
  moveExisting.addEventListener('change', () => render());
  const analyze = () => {
    preview.replaceChildren();
    try {
      groups = readLuminanceExport(input.value); selects = []; optionSignature = null; moveExisting.checked = false;
      preview.append(app.node('h3', 'Review tag groups'));
      for (const group of groups) {
        const row = app.node('div', null, 'epc-luminance-group');
        const tags = app.node('details');
        const heading = app.node('summary', group.name + ' · ' + group.tags.length);
        tags.append(heading,
          app.node('p', group.tags.join(' '), 'epc-luminance-tags'));
        if (group.note) tags.append(app.node('p', group.note, 'epc-caption'));
        const select = app.node('select');
        select.setAttribute('aria-label', 'Destination for ' + group.name);
        setSettingHelp(heading, 'Open to inspect the tags. Use the adjacent menu to choose how Companion treats this group.', select);
        select.addEventListener('change', () => render()); selects.push(select);
        row.append(tags, select); preview.append(row);
      }
      preview.append(moveLabel, app.node('p', 'Skipped settings include styles, scores, size indicators, and layout.', 'epc-caption'),
        app.node('p', '', 'epc-caption epc-luminance-conflicts'),
        app.node('p', 'Block hides matching results under Companion’s regular rules and page coverage.', 'epc-caption epc-luminance-block-note'));
      apply = app.button('Import selected tags', () => {
        if (!app.preferences.flush()) return;
        const reviewed = JSON.stringify(plan);
        const current = app.exportData();
        render(current);
        if (reviewed !== JSON.stringify(plan)) {
          status.textContent += ' · Preferences changed. Review these counts and click Import again.';
          return;
        }
        const { added, moves } = plan;
        const merge = (old, tags) => [String(old || '').trim(), ...tags].filter(Boolean).join(' ');
        const settings = {};
        const categories = tagCategoriesWithTags(current.settings);
        if (categories.some(group => added[group.id].length)) {
          const moving = new Set(moveExisting.checked ? moves.map(move => move.tag) : []);
          for (const group of categories) {
            group.tags = tagListTokens(group.tags).filter(tag => !moving.has(tag)).concat(added[group.id]).join(' ');
          }
          Object.assign(settings, tagCategorySettings(categories));
        }
        if (added.collapse.length) settings.collapsedDetailTags = merge(current.settings.collapsedDetailTags, added.collapse);
        const nse = added.block.length ? { nseTaglist: merge(current.nse.nseTaglist, added.block) } : {};
        try {
          app.importData(JSON.stringify({ format: 'empornium-companion', version: 1, settings, nse }), false, { mergePreferences: true });
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
