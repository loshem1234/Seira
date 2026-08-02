// public/js/chat.js
(function () {
    'use strict';

    const el = {
        sidebar: document.getElementById('chat-sidebar'),
        sidebarToggle: document.getElementById('sidebar-toggle'),
        newChatBtn: document.getElementById('new-chat-btn'),
        conversationList: document.getElementById('conversation-list'),
        chatLog: document.getElementById('chat-log'),
        chatForm: document.getElementById('chat-form'),
        chatInput: document.getElementById('chat-input'),
        sendBtn: document.getElementById('send-btn'),
        micBtn: document.getElementById('mic-btn'),
        inputMenuTrigger: document.getElementById('input-menu-trigger'),
        inputMenuPanel: document.getElementById('input-menu-panel'),
        fileInput: document.getElementById('file-input'),
        modelSelect: document.getElementById('model-select'),
        webSearchToggle: document.getElementById('websearch-toggle'),
        contemplationToggle: document.getElementById('contemplation-toggle'),
        attachedIndicator: document.getElementById('attached-file-indicator')
    };

    let activeConversationId = localStorage.getItem('seira_active_conversation') || null;
    let attachedText = null;
    let attachedName = null;

    // --- Sidebar: conversation list ---

    async function loadConversations() {
        const res = await fetch('/api/chat/conversations');
        const conversations = await res.json();

        if (conversations.length === 0) {
            await createConversation();
            return;
        }

        if (!activeConversationId || !conversations.find(c => String(c.id) === String(activeConversationId))) {
            activeConversationId = String(conversations[0].id);
            localStorage.setItem('seira_active_conversation', activeConversationId);
        }

        renderConversationList(conversations);
        loadHistory(activeConversationId);
    }

    function renderConversationList(conversations) {
        el.conversationList.innerHTML = '';
        conversations.forEach(c => {
            const item = document.createElement('div');
            item.className = 'conversation-item' + (String(c.id) === String(activeConversationId) ? ' active' : '');

            const title = document.createElement('span');
            title.className = 'conversation-title';
            title.textContent = c.title;
            title.addEventListener('click', () => switchConversation(c.id));

            const actions = document.createElement('span');
            actions.className = 'conversation-actions';

            const renameBtn = iconButton('rename', renameSvg(), (e) => {
                e.stopPropagation();
                const next = prompt('Rename conversation:', c.title);
                if (next && next.trim()) renameConversation(c.id, next.trim());
            });
            const deleteBtn = iconButton('delete', deleteSvg(), (e) => {
                e.stopPropagation();
                if (confirm('Delete this conversation? This cannot be undone.')) deleteConversation(c.id);
            });

            actions.appendChild(renameBtn);
            actions.appendChild(deleteBtn);
            item.appendChild(title);
            item.appendChild(actions);
            el.conversationList.appendChild(item);
        });
    }

    function iconButton(cls, svg, onClick) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'conversation-icon-btn ' + cls;
        btn.innerHTML = svg;
        btn.addEventListener('click', onClick);
        return btn;
    }

    async function createConversation() {
        const res = await fetch('/api/chat/conversations', { method: 'POST' });
        const convo = await res.json();
        activeConversationId = String(convo.id);
        localStorage.setItem('seira_active_conversation', activeConversationId);
        el.chatLog.innerHTML = '';
        await loadConversations();
    }

    function switchConversation(id) {
        activeConversationId = String(id);
        localStorage.setItem('seira_active_conversation', activeConversationId);
        loadConversations();
        collapseSidebarIfNarrow();
    }

    async function renameConversation(id, title) {
        await fetch('/api/chat/conversations/' + id + '/rename', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ title })
        });
        loadConversations();
    }

    async function deleteConversation(id) {
        await fetch('/api/chat/conversations/' + id, { method: 'DELETE' });
        if (String(id) === String(activeConversationId)) {
            activeConversationId = null;
            localStorage.removeItem('seira_active_conversation');
        }
        loadConversations();
    }

    // --- Sidebar collapse ---

    function toggleSidebar() {
        el.sidebar.classList.toggle('collapsed');
    }
    function collapseSidebarIfNarrow() {
        if (window.matchMedia('(max-width: 800px)').matches) {
            el.sidebar.classList.add('collapsed');
        }
    }
    el.sidebarToggle.addEventListener('click', toggleSidebar);
    el.newChatBtn.addEventListener('click', createConversation);

    // --- Message log ---

    function append(role, text, { withActions } = {}) {
        const wrap = document.createElement('div');
        wrap.className = 'chat-message chat-' + role;

        const body = document.createElement('div');
        body.className = 'chat-message-body';
        body.textContent = text;
        wrap.appendChild(body);

        if (role === 'seira' && withActions) {
            const actions = document.createElement('div');
            actions.className = 'message-actions';

            actions.appendChild(iconButton('msg-action', readAloudSvg(), () => readAloud(text)));
            actions.appendChild(iconButton('msg-action', copySvg(), (e) => copyText(text, e.currentTarget)));
            actions.appendChild(iconButton('msg-action', regenerateSvg(), () => regenerate(wrap)));

            wrap.appendChild(actions);
        }

        el.chatLog.appendChild(wrap);
        el.chatLog.scrollTop = el.chatLog.scrollHeight;
        return wrap;
    }

    async function loadHistory(sessionId) {
        el.chatLog.innerHTML = '';
        const res = await fetch('/api/chat/' + sessionId + '/history');
        const rows = await res.json();

        if (rows.length === 0) {
            renderFrontispiece();
            return;
        }

        rows.forEach((r, i) => {
            const isLastSeira = r.entry_type === 'output' && i === rows.length - 1;
            append(r.entry_type === 'ingestion' ? 'user' : 'seira', r.content, { withActions: isLastSeira || r.entry_type === 'output' });
        });
    }

    function renderFrontispiece() {
        const wrap = document.createElement('div');
        wrap.className = 'chat-frontispiece';
        wrap.innerHTML = `
            <svg class="seira-sigil" width="44" height="44" viewBox="0 0 28 28" fill="none" aria-hidden="true">
                <circle cx="10" cy="14" r="8" stroke="currentColor" stroke-width="0.8" opacity="0.7"/>
                <circle cx="18" cy="14" r="8" stroke="currentColor" stroke-width="0.8" opacity="0.7"/>
                <circle cx="14" cy="14" r="1.8" fill="currentColor"/>
                <line x1="14" y1="14" x2="14" y2="26" stroke="currentColor" stroke-width="1" stroke-linecap="round" opacity="0.9"/>
            </svg>
            <span class="frontispiece-name">${window.SEIRA_NAME || 'Seira'}</span>
            <div class="frontispiece-rule"><span>✦</span></div>
            <p class="frontispiece-telos">${window.SEIRA_TELOS || ''}</p>
        `;
        el.chatLog.appendChild(wrap);
    }

    // --- Message actions ---

    let currentUtterance = null;
    function readAloud(text) {
        if (!('speechSynthesis' in window)) { alert('Read-aloud is not supported in this browser.'); return; }
        if (currentUtterance) { window.speechSynthesis.cancel(); currentUtterance = null; return; }
        currentUtterance = new SpeechSynthesisUtterance(text);
        currentUtterance.onend = () => { currentUtterance = null; };
        window.speechSynthesis.speak(currentUtterance);
    }

    function copyText(text, btn) {
        navigator.clipboard.writeText(text).then(() => {
            btn.classList.add('copied');
            setTimeout(() => btn.classList.remove('copied'), 1200);
        });
    }

    async function regenerate(messageEl) {
        if (!activeConversationId) return;
        messageEl.classList.add('regenerating');
        try {
            const res = await fetch('/api/chat/' + activeConversationId + '/regenerate', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(currentOptions())
            });
            const data = await res.json();
            loadHistory(activeConversationId);
        } catch (err) {
            alert('Could not regenerate: ' + err.message);
        } finally {
            messageEl.classList.remove('regenerating');
        }
    }

    // --- Input menu ---

    el.inputMenuTrigger.addEventListener('click', (e) => {
        e.stopPropagation();
        el.inputMenuPanel.classList.toggle('open');
    });
    document.addEventListener('click', () => el.inputMenuPanel.classList.remove('open'));
    el.inputMenuPanel.addEventListener('click', (e) => e.stopPropagation());

    fetch('/api/chat/models').then(r => r.json()).then(models => {
        el.modelSelect.innerHTML = models.map(m => `<option value="${m}">${m}</option>`).join('');
    });

    el.fileInput.addEventListener('change', () => {
        const file = el.fileInput.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            attachedText = reader.result;
            attachedName = file.name;
            el.attachedIndicator.style.display = 'flex';
            el.attachedIndicator.innerHTML = `<span>${attachedName}</span>`;
            const clearBtn = document.createElement('button');
            clearBtn.type = 'button';
            clearBtn.textContent = '×';
            clearBtn.addEventListener('click', () => {
                attachedText = null; attachedName = null;
                el.attachedIndicator.style.display = 'none';
                el.fileInput.value = '';
            });
            el.attachedIndicator.appendChild(clearBtn);
        };
        reader.readAsText(file);
    });

    function currentOptions() {
        return {
            model: el.modelSelect.value,
            webSearch: el.webSearchToggle.checked,
            contemplation: el.contemplationToggle.checked
        };
    }

    // --- Mic (voice input) ---

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    let recognizing = false;
    let recognizer = null;
    if (SpeechRecognition) {
        recognizer = new SpeechRecognition();
        recognizer.continuous = false;
        recognizer.interimResults = false;
        recognizer.onresult = (e) => {
            el.chatInput.value = e.results[0][0].transcript;
        };
        recognizer.onend = () => { recognizing = false; el.micBtn.classList.remove('active'); };
        el.micBtn.addEventListener('click', () => {
            if (recognizing) { recognizer.stop(); return; }
            recognizing = true;
            el.micBtn.classList.add('active');
            recognizer.start();
        });
    } else {
        el.micBtn.disabled = true;
        el.micBtn.title = 'Voice input not supported in this browser';
    }

    // --- Auto-growing input ---

    function autoResizeInput() {
        el.chatInput.style.height = 'auto';
        el.chatInput.style.height = Math.min(el.chatInput.scrollHeight, 200) + 'px';
    }
    el.chatInput.addEventListener('input', autoResizeInput);
    el.chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            el.chatForm.requestSubmit();
        }
    });

    // --- Sending ---

    el.chatForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const message = el.chatInput.value.trim();
        if (!message || !activeConversationId) return;

        const frontispiece = el.chatLog.querySelector('.chat-frontispiece');
        if (frontispiece) frontispiece.remove();

        append('user', message);
        el.chatInput.value = '';
        autoResizeInput();
        el.chatInput.disabled = true;
        el.sendBtn.disabled = true;

        const options = currentOptions();
        const body = { sessionId: activeConversationId, message, ...options };
        if (attachedText) body.attachedText = attachedText;

        try {
            const res = await fetch('/api/chat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await res.json();
            append('seira', data.reply || ('Error: ' + data.error), { withActions: true });
            loadConversations(); // refresh sidebar (title/order may have changed)
        } catch (err) {
            append('seira', 'Something went wrong reaching her: ' + err.message);
        } finally {
            attachedText = null; attachedName = null;
            el.attachedIndicator.style.display = 'none';
            el.fileInput.value = '';
            el.chatInput.disabled = false;
            el.sendBtn.disabled = false;
            el.chatInput.focus();
        }
    });

    // --- Icons (inline SVG, gold/discreet) ---

    function readAloudSvg() {
        return '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 5.5H4L7 2.5V11.5L4 8.5H2V5.5Z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M9.5 4.5a4 4 0 010 5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>';
    }
    function copySvg() {
        return '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="5" y="5" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.2"/><path d="M9 5V3a1 1 0 00-1-1H3a1 1 0 00-1 1v5a1 1 0 001 1h2" stroke="currentColor" stroke-width="1.2"/></svg>';
    }
    function regenerateSvg() {
        return '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M2 7a5 5 0 019-3M12 7a5 5 0 01-9 3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><path d="M11 1.5V4H8.5M3 12.5V10H5.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    }
    function renameSvg() {
        return '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M8.5 1.5L10.5 3.5L4 10L1.5 10.5L2 8L8.5 1.5Z" stroke="currentColor" stroke-width="1.1" stroke-linejoin="round"/></svg>';
    }
    function deleteSvg() {
        return '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2 3.5H10M4.5 3.5V2.5A1 1 0 015.5 1.5H6.5A1 1 0 017.5 2.5V3.5M4 3.5V10A1 1 0 005 11H7A1 1 0 008 10V3.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/></svg>';
    }

    // --- Init ---
    loadConversations();
})();
