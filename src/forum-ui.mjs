// SPDX-License-Identifier: GPL-3.0-or-later
import { relativeLuminance } from './core.mjs';

export function forumSiteTheme(win, content) {
  const layers = [];
  for (let element = content; element; element = element.parentElement) {
    const match = /^(rgba?|color)\((?:srgb\s+)?([^)]+)\)$/.exec(win.getComputedStyle(element).backgroundColor);
    if (!match) continue;
    const channels = match[2].trim().split(/[\s,/]+/);
    const scale = match[1] === 'color' ? 255 : 1;
    const rgb = channels.slice(0, 3).map(channel => channel.endsWith('%') ? parseFloat(channel) * 2.55 : Number(channel) * scale);
    const opacity = channels[3] ?? '1';
    const alpha = opacity.endsWith('%') ? parseFloat(opacity) / 100 : Number(opacity);
    if (rgb.length !== 3 || !rgb.every(Number.isFinite) || !(alpha > 0 && alpha <= 1)) continue;
    layers.push({ rgb, alpha });
    if (alpha === 1) break;
  }

  const dark = win.matchMedia?.('(prefers-color-scheme: dark)')?.matches;
  // Site themes can layer a translucent post area over an opaque body background.
  const backdrop = layers.reverse().reduce((under, { rgb, alpha }) =>
    rgb.map((channel, index) => channel * alpha + under[index] * (1 - alpha)),
  dark ? [18, 24, 35] : [255, 255, 255]);
  return relativeLuminance(backdrop) <= 0.179 ? 'dark' : 'light';
}

export function forumElement(doc, tag, className = '', text = '') {
  const element = doc.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

export function forumButton(doc, text, className = '') {
  const button = forumElement(doc, 'button', className, text);
  button.type = 'button';
  return button;
}
