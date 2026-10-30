// SPDX-License-Identifier: GPL-3.0-or-later
import { SEARCH_NAMES } from './core.mjs';

const labels = {
  searchtext: 'Keywords', searchstr: 'Keywords', title: 'Title contains', taglist: 'Tags',
  filelist: 'File name contains', sizeall: 'Size', sizerange: 'Size range',
  sizetype: 'Size unit', sizeunit: 'Size unit', sizeunits: 'Size unit', sizeselect: 'Size filter',
  filter_freeleech: 'Freeleech only', limit_matches: 'Limit matches',
  order_by: 'Sort by', order_way: 'Sort direction', autocomplete_toggle: 'Autocomplete'
};
const ordinary = new Set(['searchtext', 'searchstr', 'title', 'taglist', 'filelist', 'sizeall', 'sizerange']);
const labelFor = name => labels[name] || (/^filter_cat\[(\d+)\]$/.exec(name) ? 'Category ' + /^filter_cat\[(\d+)\]$/.exec(name)[1] : name);

// Build from the saved record. Native controls provide labels/options only;
// their current values never become the saved search's draft.
export function createSavedSearchEditor(app, saved, { save, cancel }) {
  const root = app.node('section', null, 'epc-search-editor');
  root.setAttribute('aria-label', 'Edit saved search: ' + saved.title);
  root.append(app.node('strong', 'Editing “' + saved.title + '”'));
  const nameLabel = app.node('label', null, 'epc-field');
  const name = app.node('input'); name.type = 'text'; name.value = saved.title; name.required = true; name.maxLength = 300;
  name.dataset.searchTitle = ''; nameLabel.append(app.node('span', 'Search name'), name); root.append(nameLabel);
  const main = app.node('div', null, 'epc-search-editor-fields'); root.append(main);
  const more = app.node('details', null, 'epc-search-editor-extra');
  more.append(app.node('summary', 'More criteria'));
  const extra = app.node('div', null, 'epc-search-editor-fields'); more.append(extra); root.append(more);
  const status = app.node('p', '', 'epc-search-editor-status'); status.setAttribute('role', 'status');
  const groups = new Map(), order = new WeakMap(), native = Array.from(app.savedForm?.elements || []).filter(control => SEARCH_NAMES.test(control.name));
  for (const [index, field] of saved.fields.entries()) {
    if (!groups.has(field.name)) groups.set(field.name, []);
    const record = { ...field }; order.set(record, index); groups.get(field.name).push(record);
  }
  const keyword = groups.has('searchstr') && !groups.has('searchtext') ? 'searchstr' : 'searchtext';
  for (const fieldName of [keyword, 'taglist', 'title', 'filelist']) if (!groups.has(fieldName)) groups.set(fieldName, []);
  for (const control of native) if (!groups.has(control.name) && !(control.name === 'searchtext' && keyword === 'searchstr')) groups.set(control.name, []);
  const readers = [];
  const addReader = (records, read) => readers.push({ order: records.length ? Math.min(...records.map(record => order.get(record))) : saved.fields.length + readers.length, read });
  let firstActive = null, hasExtra = false;
  const entries = [...groups].sort((a, b) => {
    const active = records => records.some(field => ['checkbox', 'radio'].includes(field.type) ? field.checked : !!field.value.trim());
    return Number(active(b[1])) - Number(active(a[1]));
  });
  const rowFor = (fieldName, control, active, caption = labelFor(fieldName)) => {
    const row = app.node('label', null, 'epc-field' + (control.type === 'checkbox' ? ' epc-check' : ''));
    control.dataset.searchField = fieldName; control.maxLength = 20000;
    if (control.type === 'checkbox') row.append(control, app.node('span', caption));
    else row.append(app.node('span', caption), control);
    const primary = ordinary.has(fieldName) && active || fieldName === keyword || fieldName === 'taglist' ||
      control.type === 'checkbox' && active;
    (primary ? main : extra).append(row);
    if (!primary) hasExtra = true;
    if (active && primary && !firstActive) firstActive = control;
    return control;
  };
  for (const [fieldName, records] of entries) {
    const source = native.filter(control => control.name === fieldName);
    const kind = records[0]?.type || source[0]?.type || (fieldName === 'taglist' ? 'textarea' : 'text');
    if (kind === 'checkbox') {
      const values = records.length ? records : [{ name: fieldName, type: 'checkbox', value: source[0]?.value || '1', checked: false }];
      for (const record of values) {
        const control = app.node('input'); control.type = 'checkbox'; control.checked = !!record.checked; control.value = record.value;
        const nativeLabel = source.find(input => input.value === record.value)?.labels?.[0]?.textContent.trim();
        rowFor(fieldName, control, control.checked, /^filter_cat\[/.test(fieldName) && nativeLabel ? nativeLabel : labelFor(fieldName));
        addReader(records.length ? [record] : [], () => records.length || control.checked ? [{ ...record, checked: control.checked }] : []);
      }
      continue;
    }
    if (kind === 'radio') {
      const control = app.node('select'), empty = app.node('option', 'Not set'); empty.value = ''; control.append(empty);
      const values = [...new Set([...records.map(field => field.value), ...source.map(input => input.value)])];
      for (const value of values) {
        const caption = source.find(input => input.value === value)?.labels?.[0]?.textContent.trim();
        const option = app.node('option', caption || value); option.value = value; control.append(option);
      }
      control.value = records.find(field => field.checked)?.value || '';
      rowFor(fieldName, control, !!control.value);
      addReader(records, () => records.length ? records.map(field => ({ ...field, checked: field.value === control.value })) :
        control.value ? [{ name: fieldName, type: 'radio', value: control.value, checked: true }] : []);
      continue;
    }
    const select = source.find(control => control.tagName === 'SELECT');
    if (kind === 'select-multiple' || kind === 'select-one' || select) {
      const control = app.node('select'); control.multiple = kind === 'select-multiple';
      const choices = new Map(Array.from(select?.options || [], option => [option.value, option.textContent]));
      if (!control.multiple) choices.set('', choices.get('') || 'Not set');
      for (const record of records) if (!choices.has(record.value)) choices.set(record.value, record.value || 'Not set');
      const selected = new Set(records.map(record => record.value));
      for (const [value, caption] of choices) {
        const option = app.node('option', caption); option.value = value; option.selected = selected.has(value); control.append(option);
      }
      if (!control.multiple) control.value = records[0]?.value || '';
      rowFor(fieldName, control, records.some(record => !!record.value));
      addReader(records, () => control.multiple ? [
        ...records.filter(record => Array.from(control.selectedOptions).some(option => option.value === record.value)).map(record => ({ ...record })),
        ...Array.from(control.selectedOptions).filter(option => !records.some(record => record.value === option.value))
          .map(option => ({ name: fieldName, type: kind, checked: false, value: option.value }))
      ] : records.length ? records.map(record => ({ ...record, value: control.value })) :
        control.value ? [{ name: fieldName, type: 'select-one', value: control.value, checked: false }] : []);
      continue;
    }
    for (const record of records.length ? records : [{ name: fieldName, type: fieldName === 'taglist' ? 'textarea' : 'text', value: '', checked: false }]) {
      const control = app.node(fieldName === 'taglist' || kind === 'textarea' ? 'textarea' : 'input');
      if (control.tagName === 'INPUT') control.type = 'text'; else control.rows = 2;
      control.value = record.value; rowFor(fieldName, control, !!record.value.trim());
      addReader(records.length ? [record] : [], () => records.length || control.value ? [{ ...record, value: control.value }] : []);
    }
  }
  more.hidden = !hasExtra;
  const actions = app.node('div', null, 'epc-actions');
  const commit = () => {
    name.removeAttribute('aria-invalid');
    if (!name.value.trim()) { name.setAttribute('aria-invalid', 'true'); status.textContent = 'Enter a search name.'; name.focus({ preventScroll: true }); return; }
    try {
      // Keep unedited records byte-for-byte equivalent in value/type, including
      // fields the current site's search form doesn't expose.
      const fields = [...readers].sort((a, b) => a.order - b.order).flatMap(reader => reader.read());
      save({ title: name.value.trim(), fields });
    } catch (error) { status.textContent = error.message || 'Could not save. Your changes are still here.'; }
  };
  actions.append(app.button('Save changes', commit), app.button('Cancel', cancel)); root.append(status, actions);
  root.addEventListener('keydown', event => {
    if (event.isComposing || event.key === 'Escape' && event.target.tagName === 'SELECT') { event.stopPropagation(); return; }
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); cancel(); }
    else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's' ||
      event.key === 'Enter' && event.target.tagName === 'INPUT') { event.preventDefault(); event.stopPropagation(); commit(); }
  });
  return { element: root, focus: () => (firstActive || name).focus({ preventScroll: true }) };
}
