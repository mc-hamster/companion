// SPDX-License-Identifier: GPL-3.0-or-later
import { compileConditionalRules, CONDITIONAL_RULE_LIMIT } from './conditional-rules.mjs';
import { optionGroup } from './workspace.mjs';
import { setSettingHelp } from './setting-help.mjs';

const RULE_ACTIONS = [
  ['HIDE', 'Hide matching results', 'Hide'],
  ['SHOW', 'Allow matching results', 'Allow'],
  ['PASS', 'Hard Pass (overrides allow rules)', 'Hard Pass']
];
const RULE_FIELDS = {
  TA: { positive: 'Has tag', negative: 'Lacks tag', label: 'Tag', example: 'e.g. example.tag',
    describe: (value, negated) => 'tag ' + value + (negated ? ' is absent' : ' is present') },
  TI: { positive: 'Title contains', negative: 'Title does not contain', label: 'Title text', example: 'e.g. collection',
    describe: (value, negated) => 'title ' + (negated ? 'does not contain ' : 'contains ') + value },
  UP: { positive: 'Uploaded by', negative: 'Uploader is different from', label: 'Uploader name', example: 'e.g. example-user',
    describe: (value, negated) => 'uploader is ' + (negated ? 'different from ' : '') + value }
};
const RULE_MATCHES = Object.entries(RULE_FIELDS).flatMap(([key, field]) => [[key, field.positive], ['!' + key, field.negative]]);

function ruleSelect(app, title, options, help) {
  const field = app.node('label', null, 'epc-field'), select = app.node('select');
  for (const [value, text] of options) {
    const option = app.node('option', text); option.value = value; select.append(option);
  }
  field.append(setSettingHelp(app.node('span', title), help, select), select);
  return { field, select };
}

function describeRule(rule) {
  const action = RULE_ACTIONS.find(([key]) => key === rule.action)[2];
  const conditions = rule.tokens.map((token, index, tokens) => {
    if (typeof token === 'string') return token === 'NOT' && typeof tokens[index + 1] === 'object' ? '' : token.toLowerCase();
    return RULE_FIELDS[token.selector].describe('“' + token.value + '”', tokens[index - 1] === 'NOT');
  });
  return action + ' when ' + conditions.filter(Boolean).join(' ');
}

// The form represents flat AND/OR rules. Grouped expressions remain editable as text.
function editableRule(tokens) {
  const conditions = [];
  let join = 'AND';
  for (let i = 0; i < tokens.length;) {
    const negated = tokens[i] === 'NOT';
    if (negated) i++;
    const token = tokens[i++];
    if (typeof token !== 'object') return null;
    conditions.push({ match: (negated ? '!' : '') + token.selector, value: token.value });
    if (i === tokens.length) break;
    const next = tokens[i++];
    if (!['AND', 'OR'].includes(next) || conditions.length > 1 && next !== join) return null;
    join = next;
  }
  return { conditions, join };
}

export class ConditionalRuleEditor {
  constructor(app, parent) {
    this.app = app;
    const section = this.section = optionGroup(app, parent, 'Conditional rules', { key: 'conditional-rules' });
    this.count = section.querySelector('.epc-option-count');
    this.catalog = app.node('div');
    this.list = app.node('ul', null, 'epc-conditional-list');
    this.empty = app.node('p', 'No conditional rules yet.', 'epc-caption');
    this.add = app.button('Add a rule', () => this.openBuilder());
    this.add.classList.add('epc-primary');
    this.catalog.append(this.empty, this.list, this.add);

    this.builder = app.node('div', null, 'epc-conditional-builder');
    this.builder.hidden = true;
    this.heading = app.node('h3');
    const action = ruleSelect(app, 'When conditions match', RULE_ACTIONS,
      'Choose Hide, Allow, or Hard Pass. Hard Pass takes priority over ordinary Allow rules.');
    const match = ruleSelect(app, 'Match results that meet', [['AND', 'Every condition'], ['OR', 'Any condition']],
      'Every condition requires all checks to match. Any condition lets one matching check trigger the rule.');
    this.action = action.select; this.join = match.select; this.joinField = match.field;
    this.rows = app.node('div');
    this.addCondition = app.button('Add condition', () => this.appendCondition().focus());
    this.builderStatus = app.node('p', '', 'epc-caption');
    this.builderStatus.setAttribute('role', 'status');
    const controls = app.node('div', null, 'epc-actions');
    const save = app.button('Save rule', () => this.saveBuilder()); save.classList.add('epc-primary');
    controls.append(this.addCondition, save, app.button('Cancel', () => this.closeBuilder()));
    this.builder.append(this.heading, action.field, this.rows, match.field, controls, this.builderStatus);

    const raw = this.rawSection = app.node('details', null, 'epc-conditional-advanced');
    this.raw = app.node('textarea');
    this.raw.rows = 5; this.raw.maxLength = CONDITIONAL_RULE_LIMIT; this.raw.spellcheck = false;
    this.rawStatus = app.node('p', '', 'epc-caption'); this.rawStatus.setAttribute('role', 'status');
    this.rawStatus.id = 'epc-conditional-status';
    this.raw.setAttribute('aria-describedby', this.rawStatus.id);
    const label = app.node('label', null, 'epc-field');
    label.append(setSettingHelp(app.node('span', 'Rule text'),
      'Enter one rule per line. Use $TA for a tag, $TI for a title phrase, or $UP for an uploader, and apply the text to save it.', this.raw), this.raw);
    this.applyText = app.button('Apply rule text', () => this.saveText(this.raw.value));
    this.discardText = app.button('Discard draft', () => { this.raw.value = this.source; this.validateText(); });
    const rawControls = app.node('div', null, 'epc-actions');
    rawControls.append(this.applyText, this.discardText);
    raw.append(setSettingHelp(app.node('summary', 'Advanced rule text'), 'Edit multiple rules together or use parentheses to group conditions.'),
      app.node('p', 'Enter one rule per line. Use AND, OR, NOT, and parentheses to group conditions.', 'epc-caption'),
      app.node('code', 'HIDE: $UP{uploader} AND NOT ($TA{favorite.tag} OR $TI{collection})'), label, this.rawStatus, rawControls);
    this.raw.addEventListener('input', () => this.validateText());
    section.append(app.node('p', 'Combine tags, title text, and uploaders in one filter.', 'epc-caption'), this.catalog, this.builder, raw);
    section.addEventListener('toggle', () => { if (section.open && !this.list.hasChildNodes()) this.renderRules(); });
    this.refresh();
  }
  refresh() {
    const source = this.app.settings.conditionalRules;
    if (source === this.source) return;
    this.source = source;
    this.raw.value = source;
    this.list.replaceChildren();
    try { this.rules = compileConditionalRules(source); }
    catch { this.rules = []; this.rawSection.open = true; }
    this.count.textContent = this.rules.length ? this.rules.length + ' active' : 'None';
    this.empty.hidden = this.rules.length > 0;
    if (this.section.open) this.renderRules();
    this.validateText();
  }
  renderRules() {
    for (const [index, rule] of this.rules.entries()) {
      const item = this.app.node('li'), edit = this.app.button('Edit', () => this.openBuilder(rule, edit), 'Edit rule ' + (index + 1));
      const remove = this.app.button('Remove', () => {
        if (!this.savedDraft()) return;
        if (this.saveText(this.replaceLine(rule.line))) this.add.focus();
      }, 'Remove rule ' + (index + 1));
      const actions = this.app.node('div', null, 'epc-actions'); actions.append(edit, remove);
      item.append(this.app.node('span', describeRule(rule)), actions); this.list.append(item);
    }
  }
  validateText() {
    const changed = this.raw.value !== this.source;
    this.discardText.disabled = !changed;
    this.applyText.disabled = true;
    try {
      compileConditionalRules(this.raw.value);
      this.raw.removeAttribute('aria-invalid');
      this.rawStatus.textContent = changed ? 'Ready to apply.' : '';
      this.applyText.disabled = !changed;
    } catch (error) {
      this.raw.setAttribute('aria-invalid', 'true');
      this.rawStatus.textContent = error.message;
    }
  }
  savedDraft() {
    if (this.raw.value === this.source) return true;
    this.section.open = this.rawSection.open = true;
    this.raw.focus();
    this.app.toast('Apply or discard the advanced rule draft first.');
    return false;
  }
  openBuilder(rule, opener = this.add) {
    if (!this.savedDraft()) return;
    const draft = rule && editableRule(rule.tokens);
    if (rule && !draft) {
      this.rawSection.open = true;
      this.raw.focus();
      const lines = this.source.split('\n'), start = lines.slice(0, rule.line).join('\n').length + (rule.line ? 1 : 0);
      this.raw.setSelectionRange(start, start + lines[rule.line].length);
      return;
    }
    this.opener = opener; this.editing = rule && { line: rule.line, source: this.source };
    this.heading.textContent = rule ? 'Edit rule' : 'New rule';
    this.action.value = rule?.action || 'HIDE';
    this.join.value = draft?.join || 'AND';
    this.rows.replaceChildren(); this.builderStatus.textContent = '';
    this.builder.hidden = false; this.catalog.hidden = this.rawSection.hidden = true;
    for (const condition of draft?.conditions || [{}]) this.appendCondition(condition);
    this.rows.querySelector('input').focus();
  }
  appendCondition({ match = 'TA', value = '' } = {}) {
    const row = this.app.node('div', null, 'epc-conditional-row');
    const condition = ruleSelect(this.app, 'Condition', RULE_MATCHES,
      'Pick what to match on this result, or choose a negative condition to match when the value is absent.');
    condition.select.value = match;
    const label = this.app.node('label', null, 'epc-field'), caption = this.app.node('span');
    const input = this.app.node('input'); input.type = 'text'; input.value = value;
    const sync = () => {
      const field = RULE_FIELDS[condition.select.value.replace('!', '')];
      caption.textContent = field.label;
      input.placeholder = field.example;
      setSettingHelp(caption, 'Enter the ' + field.label.toLowerCase() + ' to check. ' + field.example, input);
    };
    condition.select.addEventListener('change', sync); sync();
    input.addEventListener('input', () => input.removeAttribute('aria-invalid'));
    label.append(caption, input);
    const remove = this.app.button('Remove condition', () => {
      row.remove(); this.syncConditions(); this.addCondition.focus();
    });
    row.append(condition.field, label, remove); this.rows.append(row);
    this.syncConditions();
    return input;
  }
  syncConditions() {
    const multiple = this.rows.children.length > 1;
    this.joinField.hidden = !multiple;
    for (const [index, row] of [...this.rows.children].entries()) {
      const label = row.querySelector('select').closest('label').firstChild;
      label.textContent = multiple ? 'Condition ' + (index + 1) : 'Condition';
      const remove = row.querySelector('button'); remove.hidden = !multiple;
      remove.setAttribute('aria-label', 'Remove condition ' + (index + 1));
    }
  }
  saveBuilder() {
    const parts = [];
    for (const row of this.rows.children) {
      const input = row.querySelector('input'), value = input.value.trim(), match = row.querySelector('select').value;
      if (!value || /[{}\r\n]/.test(value)) {
        this.builderStatus.textContent = value ? 'Use text without braces.' : 'Enter text for this condition.';
        input.setAttribute('aria-invalid', 'true'); input.focus(); return;
      }
      const atom = '$' + match.replace('!', '') + '{' + value + '}';
      parts.push(match.startsWith('!') ? 'NOT ' + atom : atom);
    }
    const line = this.action.value + ': ' + parts.join(' ' + this.join.value + ' ');
    if (this.editing && this.editing.source !== this.source) {
      this.builderStatus.textContent = 'The saved rules changed. Reopen this rule to edit the latest version.'; return;
    }
    const text = this.editing ? this.replaceLine(this.editing.line, line) : [this.source.trimEnd(), line].filter(Boolean).join('\n');
    if (this.saveText(text, this.builderStatus)) this.closeBuilder();
  }
  replaceLine(index, value) {
    const lines = this.source.split('\n');
    lines.splice(index, 1, ...(value ? [value] : []));
    return lines.join('\n');
  }
  saveText(text, status = this.rawStatus) {
    try { compileConditionalRules(text); }
    catch (error) { status.textContent = error.message; return false; }
    if (this.app.preferences.flush(text)) return true;
    status.textContent = 'Could not apply the rules. Your draft is still here.';
    return false;
  }
  addTagRule(tag, uploader) {
    if (!this.savedDraft()) return false;
    const line = 'HIDE: $TA{' + tag + '} AND $UP{' + uploader + '}';
    if (this.source.split('\n').some(rule => rule.trim().toLocaleLowerCase() === line.toLocaleLowerCase())) return true;
    return this.saveText([this.source.trimEnd(), line].filter(Boolean).join('\n'));
  }
  closeBuilder() {
    this.builder.hidden = true; this.catalog.hidden = this.rawSection.hidden = false;
    (this.opener?.isConnected ? this.opener : this.add).focus();
  }
}
