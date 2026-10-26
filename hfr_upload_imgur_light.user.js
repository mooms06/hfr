// ==UserScript==
// @name         [HFR] Upload Imgur Light
// @namespace    forum.hardware.fr
// @version      0.2.6
// @description  Colle ou sélectionne une image, l'envoie à Imgur et choisit sa taille BBCode.
// @icon         https://www.hardware.fr/images_skin_2010/facebook/logo.png
// @match        https://forum.hardware.fr/*
// @noframes
// @author       mooms06
// @updateURL    https://raw.githubusercontent.com/mooms06/hfr/master/hfr_upload_imgur_light.user.js
// @installURL   https://raw.githubusercontent.com/mooms06/hfr/master/hfr_upload_imgur_light.user.js
// @downloadURL  https://raw.githubusercontent.com/mooms06/hfr/master/hfr_upload_imgur_light.user.js
// @supportURL   https://forum.hardware.fr/hfr/Discussions/Viepratique/sujet_116015_1.htm
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @connect      api.imgur.com
// ==/UserScript==

(() => {
    'use strict';

    const CLIENT_ID = 'd1619618d2ac442';
    const ENDPOINT = 'https://api.imgur.com/3/image';
    const MAX_BYTES = 20 * 1024 * 1024;
    const HISTORY_KEY = 'hfr-imgur-light-deletions';
    const DEFAULT_SIZE_KEY = 'hfr-imgur-light-default-size';
    const registered = new WeakSet();
    const busy = new WeakSet();
    const sizes = [
        ['Original', ''], ['Petit carré', 's'], ['Grand carré', 'b'],
        ['Petite miniature', 't'], ['Moyenne miniature', 'm'],
        ['Grande miniature', 'l'], ['Énorme miniature', 'h']
    ];

    function defaultSize() {
        const value = GM_getValue(DEFAULT_SIZE_KEY, null);
        return sizes.some(([, suffix]) => suffix === value) ? value : null;
    }

    function showDefaultSizeMenu() {
        const dialog = document.createElement('dialog');
        dialog.style.cssText = 'max-width:92vw;border:1px solid #888;border-radius:8px;padding:16px;font:14px sans-serif;';
        const heading = document.createElement('h3');
        heading.textContent = 'Taille de miniature par défaut';
        const label = document.createElement('label');
        label.textContent = 'Après chaque envoi : ';
        const select = document.createElement('select');
        const current = defaultSize();
        for (const [text, value] of [['Demander à chaque fois', 'ask'], ...sizes]) {
            const option = document.createElement('option');
            option.textContent = text;
            option.value = value;
            select.append(option);
        }
        select.value = current === null ? 'ask' : current;
        label.append(select);
        const hint = document.createElement('p');
        hint.textContent = 'Une taille fixe insère directement le BBCode avec un lien vers l’original. Les GIF restent en taille originale.';
        const save = document.createElement('button');
        save.type = 'button';
        save.textContent = 'Enregistrer';
        save.addEventListener('click', () => {
            GM_setValue(DEFAULT_SIZE_KEY, select.value === 'ask' ? null : select.value);
            dialog.close();
        });
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.textContent = 'Annuler';
        cancel.style.marginLeft = '8px';
        cancel.addEventListener('click', () => dialog.close());
        dialog.append(heading, label, hint, save, cancel);
        dialog.addEventListener('close', () => dialog.remove(), { once: true });
        document.body.append(dialog);
        dialog.showModal();
    }

    function imageCode(image, suffix, linked) {
        const url = suffix ? image.link.replace(/(\.[^.?#]+)$/, suffix + '$1') : image.link;
        const code = '[img]' + url + '[/img]';
        return linked ? '[url=' + image.link + ']' + code + '[/url]' : code;
    }

    function safeUrl(value) {
        if (typeof value !== 'string') throw new Error('URL Imgur absente');
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.hostname !== 'i.imgur.com' ||
            url.username || url.password || url.search || url.hash ||
            !/^\/[a-zA-Z0-9]+\.(?:png|jpe?g|gif|webp)$/i.test(url.pathname)) {
            throw new Error('URL Imgur inattendue');
        }
        return url.href;
    }

    function requestImgur(method, path, data) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method,
                url: ENDPOINT + path,
                headers: { Authorization: `Client-ID ${CLIENT_ID}` },
                data,
                timeout: 30000,
                onload(response) {
                    let body;
                    try { body = JSON.parse(response.responseText); }
                    catch { reject(new Error('Réponse Imgur invalide')); return; }
                    if (response.status < 200 || response.status >= 300 || !body?.success) {
                        const message = typeof body?.data?.error === 'string'
                            ? body.data.error : `Échec Imgur (HTTP ${response.status})`;
                        reject(new Error(message));
                        return;
                    }
                    resolve(body.data);
                },
                onerror: () => reject(new Error('Erreur réseau')),
                ontimeout: () => reject(new Error('Délai dépassé')),
                onabort: () => reject(new Error('Envoi interrompu'))
            });
        });
    }

    function history() {
        const list = GM_getValue(HISTORY_KEY, []);
        return Array.isArray(list) ? list : [];
    }

    function remember(image) {
        if (!/^[a-zA-Z0-9]+$/.test(image.deletehash || '')) return;
        GM_setValue(HISTORY_KEY, [...history(), {
            url: image.link,
            hash: image.deletehash
        }].slice(-10));
    }

    function showDeletionMenu() {
        const dialog = document.createElement('dialog');
        dialog.style.cssText = 'max-width:min(95vw,750px);max-height:85vh;overflow:auto;border:1px solid #888;border-radius:8px;padding:16px;font:13px sans-serif;';
        const title = document.createElement('h3');
        title.textContent = 'Les 10 dernières images envoyées sur Imgur';
        dialog.append(title);

        const content = document.createElement('div');
        const render = () => {
            content.replaceChildren();
            const entries = history().slice(-10).reverse();
            if (!entries.length) content.textContent = 'Aucune image enregistrée.';
            for (const image of entries) {
                const row = document.createElement('div');
                row.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #ddd';
                const preview = document.createElement('img');
                preview.src = image.url;
                preview.alt = 'Miniature';
                preview.style.cssText = 'width:64px;height:64px;object-fit:contain';
                const details = document.createElement('div');
                details.style.cssText = 'min-width:0;flex:1;overflow-wrap:anywhere';
                const url = document.createElement('div');
                url.textContent = image.url;
                const hash = document.createElement('code');
                hash.textContent = `Hash : ${image.hash}`;
                details.append(url, hash);
                const erase = document.createElement('button');
                erase.type = 'button';
                erase.textContent = 'Effacer';
                erase.addEventListener('click', async () => {
                    if (!confirm(`Effacer cette image sur Imgur ?\n${image.url}`)) return;
                    erase.disabled = true;
                    erase.textContent = 'Effacement…';
                    try {
                        await requestImgur('DELETE', '/' + image.hash);
                        GM_setValue(HISTORY_KEY, history().filter(item => item.hash !== image.hash));
                        render();
                    } catch (error) {
                        erase.disabled = false;
                        erase.textContent = 'Effacer';
                        alert(`Échec : ${error.message}`);
                    }
                });
                row.append(preview, details, erase);
                content.append(row);
            }
        };
        render();
        const close = document.createElement('button');
        close.type = 'button';
        close.textContent = 'Fermer';
        close.style.marginTop = '12px';
        close.addEventListener('click', () => dialog.close());
        dialog.append(content, close);
        dialog.addEventListener('close', () => dialog.remove(), { once: true });
        document.body.append(dialog);
        dialog.showModal();
    }

    GM_registerMenuCommand('Upload Imgur Light : liste et effacement des images', showDeletionMenu);
    GM_registerMenuCommand('Upload Imgur Light : taille de miniature par défaut', showDefaultSizeMenu);

    function insert(textarea, text, selection) {
        // Le texte n'a pas changé : insertion à la position mémorisée.
        if (textarea.value === selection.value) {
            textarea.setRangeText(text, selection.start, selection.end, 'end');
        } else {
            // Le message a changé : ne jamais écraser une nouvelle sélection.
            const cursor = textarea.selectionStart;
            textarea.setRangeText(text, cursor, cursor, 'end');
        }
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
    }

    function chooseSize(image, textarea, selection) {
        const dialog = document.createElement('dialog');
        dialog.style.cssText = 'max-width:min(92vw,650px);border:1px solid #888;border-radius:8px;padding:16px;font:14px sans-serif;';

        const heading = document.createElement('div');
        heading.textContent = 'Choisir la taille de l’image';
        heading.style.cssText = 'font-weight:bold;margin-bottom:10px';

        const preview = document.createElement('img');
        preview.src = image.link;
        preview.alt = 'Image envoyée vers Imgur';
        preview.style.cssText = 'display:block;max-width:100%;max-height:180px;margin:0 auto 12px;object-fit:contain';

        const choices = document.createElement('div');
        choices.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;justify-content:center';
        const options = image.type === 'image/gif' ? sizes.slice(0, 1) : sizes;

        for (const [label, suffix] of options) {
            const button = document.createElement('button');
            button.type = 'button';
            button.textContent = label;
            button.title = 'Clic : avec lien ; clic droit : sans lien';
            const apply = linked => {
                insert(textarea, imageCode(image, suffix, linked), selection);
                dialog.close();
            };
            button.addEventListener('click', () => apply(true));
            button.addEventListener('contextmenu', event => {
                event.preventDefault();
                apply(false);
            });
            choices.append(button);
        }

        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.textContent = 'Fermer';
        cancel.style.marginTop = '12px';
        cancel.addEventListener('click', () => dialog.close());
        dialog.append(heading, preview, choices, cancel);
        dialog.addEventListener('close', () => dialog.remove(), { once: true });
        document.body.append(dialog);
        dialog.showModal();
    }

    async function upload(file, textarea, status) {
        if (busy.has(textarea)) {
            status.textContent = 'Un envoi est déjà en cours.';
            return;
        }
        if (!file || !['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) {
            status.textContent = 'Format accepté : PNG, JPEG, GIF ou WebP.';
            return;
        }
        if (!file.size || file.size > MAX_BYTES) {
            status.textContent = 'Image vide ou supérieure à 20 Mo.';
            return;
        }

        busy.add(textarea);
        const selection = {
            value: textarea.value,
            start: textarea.selectionStart,
            end: textarea.selectionEnd
        };
        status.textContent = 'Envoi vers Imgur…';

        try {
            const data = new FormData();
            data.append('image', file, file.name || 'image.png');
            const image = await requestImgur('POST', '', data);
            image.link = safeUrl(image?.link);
            if (!/^[a-zA-Z0-9]+$/.test(image.id || ''))
                throw new Error('Identifiant Imgur invalide');
            remember(image);
            const suffix = defaultSize();
            if (suffix === null) {
                chooseSize(image, textarea, selection);
                status.textContent = 'Image envoyée ✓ — choisis sa taille';
            } else {
                insert(textarea, imageCode(image, image.type === 'image/gif' ? '' : suffix, true), selection);
                status.textContent = 'Image envoyée et insérée ✓';
            }
        } catch (error) {
            console.error('[HFR Upload Imgur Light]', error);
            status.textContent = `Échec : ${error.message || 'erreur inconnue'}`;
        } finally {
            busy.delete(textarea);
        }
    }

    function register(textarea) {
        if (registered.has(textarea)) return;
        registered.add(textarea);

        const controls = document.createElement('span');
        controls.className = 'hfr-imgur-light-control';
        controls.style.cssText = 'display:inline-flex;align-items:center;gap:6px;margin-left:4px;font:12px sans-serif';
        const label = document.createElement('label');
        label.style.cursor = 'pointer';
        label.title = 'Sélectionnez une image';
        const icon = document.createElement('span');
        icon.textContent = '📷';
        icon.style.cssText = 'font-size:20px;line-height:20px;vertical-align:middle';
        const picker = document.createElement('input');
        picker.type = 'file';
        picker.accept = 'image/png,image/jpeg,image/gif,image/webp';
        picker.hidden = true;
        label.append(icon, picker);
        const status = document.createElement('span');
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');

        picker.addEventListener('change', () => {
            const file = picker.files?.[0];
            picker.value = '';
            if (file) void upload(file, textarea, status);
        });
        textarea.addEventListener('paste', event => {
            const file = Array.from(event.clipboardData?.files || [])
                .find(item => item.type.startsWith('image/'));
            if (!file) return; // Collage de texte normal, sans interception.
            event.preventDefault();
            void upload(file, textarea, status);
        });

        controls.append(label, status);
        // Position d'origine : immédiatement après le bouton de validation du formulaire.
        textarea.addEventListener('focus', () => {
            if (controls.isConnected) return;
            const form = textarea.closest('form');
            const button = (form || textarea.parentElement)
                ?.querySelector('input[type="button"],input[type="submit"]');
            if (button?.parentElement) {
                if (button.parentElement.querySelector('.hfr-imgur-light-control')) return;
                button.insertAdjacentElement('afterend', controls);
            } else {
                textarea.insertAdjacentElement('afterend', controls);
            }
        });
    }

    document.querySelectorAll('textarea').forEach(register);
    new MutationObserver(mutations => {
        for (const mutation of mutations) {
            for (const node of mutation.addedNodes) {
                if (!(node instanceof Element)) continue;
                if (node.matches('textarea')) register(node);
                node.querySelectorAll('textarea').forEach(register);
            }
        }
    }).observe(document.body, { childList: true, subtree: true });
})();
