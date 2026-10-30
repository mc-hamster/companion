// SPDX-License-Identifier: GPL-3.0-or-later
export const NSE_EMPTY_LISTS = ['nseTaglist', 'nseHardPassTaglist', 'nseWhitelist',
  'nseBlacklistTitles', 'nseHardPassTitles', 'nseWhitelistTitles', 'nseUploaders', 'nseWhitelistUploaders'];
// Compatible with mc-hamster's fork, while the pinned upstream engine retains
// its own complete schema/readers. Companion owns these controls.
export const NSE_BACKFILL_SCHEMA = { nseBackfillButtonEnabled: 'boolean', nseBackfillPageLimit: 'number' };

export function validateNSE(input, schema) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid filter settings object.');
  const result = {};
  const color = /^(?:#[0-9a-f]{3,8}|[a-z]{1,30}|rgba?\([\d.,%\s]+\)|hsla?\([\d.,%\s]+\))$/i;
  for (const [key, value] of Object.entries(input)) {
    const type = Object.hasOwn(schema, key) ? schema[key] :
      Object.hasOwn(NSE_BACKFILL_SCHEMA, key) && NSE_BACKFILL_SCHEMA[key];
    if (!type) throw new Error('Unknown filter preference in the import file.');
    if (type === 'array') {
      if (!Array.isArray(value) || value.length > 100000 || value.some(id => !/^\d{1,15}$/.test(String(id)))) {
        throw new Error('Invalid list of individual result overrides.');
      }
      result[key] = [...new Set(value.map(String))]; continue;
    }
    if (type === 'object') {
      const names = ['backgroundColor', 'backgroundHighlightColor', 'foregroundColor', 'accentColor', 'highlightColor', 'hiddenBackgroundColor'];
      if (!value || typeof value !== 'object' || Array.isArray(value) ||
          Object.keys(value).some(name => !names.includes(name)) ||
          names.slice(0, 5).some(name => !color.test(value[name] || '')) ||
          value.hiddenBackgroundColor && !color.test(value.hiddenBackgroundColor)) throw new Error('Invalid custom theme.');
      result[key] = { ...value }; continue;
    }
    if (typeof value !== type || type === 'number' && (!Number.isFinite(value) || value < 0 || value > 10000000) ||
        type === 'string' && value.length > (key === 'nseCustomCSS' ? 2000000 : 500000)) {
      throw new Error('A filter preference has an invalid value.');
    }
    if (/Color$/.test(key) && !color.test(value)) throw new Error('Invalid filter highlight color.');
    if (/Font$/.test(key) && !/^[\w\s,'".-]{1,200}$/.test(value)) throw new Error('Invalid font family.');
    if (key === 'nseSelectedTheme' && !/^nseTheme(?:Default|Legacy|Edgy|Baked|DarkPurple|Custom)$/.test(value)) throw new Error('Invalid theme.');
    result[key] = key === 'nseBackfillPageLimit' ? Math.floor(Math.min(15, Math.max(1, value))) : value;
  }
  return result;
}
