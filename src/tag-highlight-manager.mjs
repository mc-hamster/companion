// SPDX-License-Identifier: GPL-3.0-or-later
import { isSaveShortcut, tagListTokens } from './core.mjs';
import { styleHighlight } from './result-tools.mjs';

export class TagHighlightManager {
  constructor(app, section) {
    this.app = app;
    this.highlights = app.tags;
    this.section = section;
    this.views = new Map();
    this.selection = new Set();
    this.list = app.node('div', null, 'epc-tag-categories');
    const add = app.button('Add category', () => this.addCategory());
    section.append(app.node('p', 'Open any category to change its color.', 'epc-caption'), this.list, add, this.buildSearch());
    this.refresh();
  }
  field(caption, control, className = 'epc-field') {
    const label = this.app.node('label', null, className);
    label.append(this.app.node('span', caption), control);
    return label;
  }
  createView(id) {
    const app = this.app;
    const node = app.node('details', null, 'epc-tag-category');
    node.dataset.tagCategory = id;
    const summary = app.node('summary');
    const preview = app.node('span', null, 'epc-tag-swatch');
    const count = app.node('small', null, 'epc-caption');
    const unsaved = app.node('small', 'Unsaved edits', 'epc-caption'); unsaved.hidden = true;
    summary.append(preview, count, unsaved);
    const name = app.node('input'); name.type = 'text'; name.maxLength = 64; name.required = true;
    const color = app.node('input'); color.type = 'color';
    const enabled = app.node('input'); enabled.type = 'checkbox';
    const fields = app.node('div', null, 'epc-tag-category-fields');
    fields.append(this.field('Category name', name), this.field('Color', color), this.field('Enabled', enabled, 'epc-check'));
    const tags = app.node('textarea'); tags.rows = 3; tags.maxLength = 50000; tags.dataset.tagList = id;
    const status = app.node('p', '', 'epc-caption'); status.setAttribute('role', 'status');
    const save = app.button('Save tags', () => this.saveTags(id));
    const keep = app.button('Save without conflicting tags', () => this.saveTags(id, 'keep'));
    const move = app.button('Move conflicting tags', () => this.saveTags(id, 'move'));
    const discard = app.button('Discard tag edits', () => {
      view.tags.value = view.baseTags = this.highlights.categories().find(group => group.id === id).tags;
      this.clearConflict(view); this.syncDraft(view); tags.focus();
    });
    keep.hidden = move.hidden = true;
    const earlier = app.button('Move up', () => this.reorder(id, -1));
    const later = app.button('Move down', () => this.reorder(id, 1));
    const browse = app.button('Show matches', () => this.highlights.showMatches(id));
    const actions = app.node('div', null, 'epc-actions'); actions.append(browse, earlier, later);
    const saveActions = app.node('div', null, 'epc-actions'); saveActions.append(save, discard, keep, move);
    node.append(summary, fields, actions, this.field('Tags', tags), saveActions, status);
    tags.placeholder = 'Separate tags with spaces or new lines';
    const view = { node, name, color, enabled, tags, status, preview, count, unsaved, discard, earlier, later, browse, keep, move, baseTags: '' };
    this.views.set(id, view);
    for (const [key, control] of [['name', name], ['color', color], ['enabled', enabled]]) {
      control.addEventListener('change', () => {
        const value = key === 'enabled' ? control.checked : control.value.trim();
        const categories = this.highlights.categories();
        if (key === 'name' && (!value || categories.some(group => group.id !== id && group.name.toLowerCase() === value.toLowerCase()))) {
          status.textContent = 'Enter a unique category name.';
          control.value = categories.find(group => group.id === id).name;
          return;
        }
        const saved = this.highlights.commit(groups => {
          const group = groups.find(group => group.id === id);
          group[key] = value;
          if (key === 'color') group.colorCustomized = true;
          if (key === 'name' && id === 'caution') group.nameCustomized = true;
        });
        status.textContent = saved ? '' : 'Could not save the category.';
        this.refresh();
      });
    }
    color.addEventListener('input', () => styleHighlight(preview, color.value));
    tags.addEventListener('input', () => { this.clearConflict(view); this.syncDraft(view); });
    tags.addEventListener('keydown', event => {
      if (!app.settings.keyboardShortcuts || event.isComposing || !isSaveShortcut(event)) return;
      event.preventDefault();
      this.saveTags(id);
    });
    return view;
  }
  refresh() {
    const groups = this.highlights.categories();
    for (const [id, view] of this.views) if (!groups.some(group => group.id === id)) {
      view.node.remove(); this.views.delete(id);
    }
    let count = 0;
    for (const [index, group] of groups.entries()) {
      const view = this.views.get(group.id) || this.createView(group.id);
      const tagCount = tagListTokens(group.tags).length;
      count += tagCount;
      if (view.tags.value === view.baseTags) { view.tags.value = group.tags; view.baseTags = group.tags; }
      view.name.value = group.name; view.color.value = group.color; view.enabled.checked = group.enabled;
      view.preview.textContent = group.name; styleHighlight(view.preview, group.color);
      view.count.textContent = tagCount + (tagCount === 1 ? ' tag' : ' tags') + (group.enabled ? '' : ' · Disabled');
      view.earlier.disabled = index === 0; view.later.disabled = index === groups.length - 1;
      this.syncDraft(view);
      if (this.list.children[index] !== view.node) this.list.insertBefore(view.node, this.list.children[index] || null);
    }
    this.section.querySelector('.epc-option-count').textContent = count + (count === 1 ? ' tag' : ' tags');
    this.syncAvailability(this.resultsAvailable);
    this.renderSearch();
  }
  syncAvailability(available) {
    this.resultsAvailable = available;
    for (const view of this.views.values()) view.browse.hidden = !available;
  }
  syncDraft(view) {
    const dirty = view.tags.value !== view.baseTags;
    view.unsaved.hidden = view.discard.hidden = !dirty;
    view.browse.disabled = !view.enabled.checked || dirty;
    view.browse.title = dirty ? 'Save or discard the tag edits to show matches.' : '';
  }
  addCategory() {
    const { app } = this;
    const id = 'custom-' + app.win.crypto.randomUUID();
    if (!this.highlights.commit(groups => {
      const names = new Set(groups.map(group => group.name.toLowerCase()));
      let name = 'New category';
      for (let i = 2; names.has(name.toLowerCase()); i++) name = 'New category ' + i;
      groups.push({ id, name, color: '#ccefe0', enabled: true, tags: '' });
    })) return;
    const view = this.views.get(id);
    view.node.open = true; view.name.focus(); view.name.select();
  }
  reorder(id, offset) {
    if (!this.highlights.commit(groups => {
      const index = groups.findIndex(group => group.id === id), target = index + offset;
      if (target < 0 || target >= groups.length) return;
      [groups[index], groups[target]] = [groups[target], groups[index]];
    })) return;
    const view = this.views.get(id);
    const button = offset < 0 ? view.earlier : view.later;
    (button.disabled ? view.node.firstElementChild : button).focus();
  }
  clearConflict(view) {
    view.conflictSignature = null;
    view.status.textContent = '';
    view.keep.hidden = view.move.hidden = true;
  }
  saveTags(id, decision) {
    const view = this.views.get(id);
    if (view.tags.value.length > view.tags.maxLength) {
      view.status.textContent = 'Tag highlight list exceeds 50,000 characters.';
      return;
    }
    if (!this.app.preferences.flush() || this.highlights.refreshStoredPreferences(true)) return;
    this.highlights.categories();
    const draft = new Set(tagListTokens(view.tags.value));
    const removed = new Set(tagListTokens(view.baseTags).filter(tag => !draft.has(tag)));
    const conflicts = new Map();
    for (const tag of draft) {
      const owner = this.highlights.assignments.get(tag);
      if (owner && owner.id !== id) conflicts.set(tag, owner);
    }
    const signature = JSON.stringify([...conflicts].map(([tag, owner]) => [tag, owner.id]));
    if (conflicts.size && (!decision || signature !== view.conflictSignature)) {
      const sample = [...conflicts].slice(0, 6).map(([tag, owner]) => tag + ' (' + owner.name + ')');
      view.status.textContent = conflicts.size + (conflicts.size === 1 ? ' tag already assigned · ' : ' tags already assigned · ') +
        sample.join(', ') + (conflicts.size > sample.length ? ' and ' + (conflicts.size - sample.length) + ' more' : '');
      view.conflictSignature = signature;
      view.keep.hidden = view.move.hidden = false;
      return;
    }
    const additions = [...draft].filter(tag => decision === 'move' || !conflicts.has(tag));
    if (!this.highlights.commit(groups => {
      for (const group of groups) {
        if (group.id === id) group.tags = [...new Set([...tagListTokens(group.tags).filter(tag => !removed.has(tag)), ...additions])].join(' ');
        else if (decision === 'move') group.tags = tagListTokens(group.tags).filter(tag => !conflicts.has(tag)).join(' ');
      }
    })) { view.status.textContent = 'Could not save the tags.'; return; }
    const saved = this.highlights.categories().find(group => group.id === id).tags;
    view.tags.value = view.baseTags = saved;
    this.clearConflict(view); this.syncDraft(view); view.status.textContent = 'Tags saved.';
  }
  buildSearch() {
    const app = this.app;
    const section = app.node('details', null, 'epc-tag-search');
    section.append(app.node('summary', 'Find and move tags'));
    this.query = app.node('input'); this.query.type = 'search';
    this.query.addEventListener('input', () => { this.selection.clear(); this.limit = 50; this.renderSearch(); });
    this.results = app.node('div', null, 'epc-tag-search-results');
    this.searchStatus = app.node('p', '', 'epc-caption'); this.searchStatus.setAttribute('role', 'status');
    this.more = app.button('Show more tags', () => { this.limit += 50; this.renderSearch(); });
    this.destination = app.node('select');
    this.moveSelected = app.button('Move selected', () => this.finishBulk(this.destination.value));
    this.clearSelected = app.button('Clear selected highlights', () => this.finishBulk(''));
    this.bulkActions = app.node('div', null, 'epc-actions');
    this.bulkActions.append(this.field('Move to category', this.destination), this.moveSelected, this.clearSelected);
    section.append(this.field('Find a tag', this.query), this.searchStatus, this.results, this.more, this.bulkActions);
    return section;
  }
  renderSearch() {
    const query = this.query.value.trim().toLocaleLowerCase(), app = this.app;
    const matches = query ? [...this.highlights.assignments].filter(([tag]) => tag.includes(query)) : [];
    const found = new Set(matches.map(([tag]) => tag));
    for (const tag of this.selection) if (!found.has(tag)) this.selection.delete(tag);
    const limit = this.limit || 50;
    this.results.replaceChildren(...matches.slice(0, limit).map(([tag, group]) => {
      const input = app.node('input'); input.type = 'checkbox'; input.checked = this.selection.has(tag);
      const label = app.node('label', null, 'epc-tag-search-row');
      const badge = app.node('span', group.name, 'epc-tag-swatch'); styleHighlight(badge, group.color);
      label.append(input, app.node('span', tag), badge);
      input.addEventListener('change', () => {
        if (input.checked) this.selection.add(tag); else this.selection.delete(tag);
        this.syncSelection();
      });
      return label;
    }));
    const destination = this.destination.value;
    this.destination.replaceChildren(...this.highlights.categories().map(group => {
      const option = app.node('option', group.name + (group.enabled ? '' : ' (disabled)')); option.value = group.id; return option;
    }));
    if ([...this.destination.options].some(option => option.value === destination)) this.destination.value = destination;
    this.more.hidden = matches.length <= limit;
    this.bulkActions.hidden = !matches.length;
    this.searchStatus.textContent = !query ? '' : matches.length ? matches.length + (matches.length === 1 ? ' matching tag' : ' matching tags') : 'No assigned tags match.';
    this.syncSelection();
  }
  syncSelection() {
    this.moveSelected.disabled = this.clearSelected.disabled = !this.selection.size;
  }
  finishBulk(id) {
    if (!this.selection.size) return;
    const count = this.selection.size;
    if (!this.highlights.assign(this.selection, id)) return;
    this.selection.clear(); this.renderSearch();
    this.searchStatus.textContent = count + (count === 1 ? ' tag' : ' tags') + (id ? ' moved.' : ' cleared.');
  }
}
