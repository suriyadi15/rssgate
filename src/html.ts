const escapes: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const escapeHtml = (text: string) => text.replaceAll(/[&<>"']/g, (c) => escapes[c]);

/** Plain text to HTML with line breaks. */
export const textToHtml = (text: string) => escapeHtml(text).replaceAll(/\r\n|\r|\n/g, '<br>');

export const img = (src: string | undefined, alt = '') => (src ? `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}">` : '');

export const video = (src: string, poster?: string) => `<video controls preload="metadata" src="${escapeHtml(src)}"${poster ? ` poster="${escapeHtml(poster)}"` : ''}></video>`;

export const link = (href: string, text: string) => `<a href="${escapeHtml(href)}">${escapeHtml(text)}</a>`;
