// SPDX-License-Identifier: GPL-3.0-or-later
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
