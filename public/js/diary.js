// public/js/diary.js
(function () {
    'use strict';

    const tabs = document.querySelectorAll('.diary-tab');
    const panels = {
        self: document.getElementById('panel-self'),
        architect: document.getElementById('panel-architect'),
        logs: document.getElementById('panel-logs')
    };

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            Object.keys(panels).forEach(key => {
                panels[key].style.display = key === tab.dataset.tab ? 'block' : 'none';
            });
        });
    });

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function entryBlock(dateLabel, content) {
        return `<div class="diary-entry"><div class="diary-meta">${escapeHtml(dateLabel)}</div>${escapeHtml(content)}</div>`;
    }

    async function loadDiaryPart(part, container) {
        const res = await fetch('/api/psyche/diary?part=' + part);
        const entries = await res.json();
        if (entries.length === 0) {
            container.innerHTML = '<p class="empty-note">Nothing here yet.</p>';
            return;
        }
        container.innerHTML = entries.map(e => entryBlock(e.entry_date, e.content)).join('');
    }

    async function loadDigestRuns() {
        const container = document.getElementById('logs-digest');
        const res = await fetch('/api/psyche/digest-runs');
        const runs = await res.json();
        if (runs.length === 0) {
            container.innerHTML = '<p class="empty-note">No digest cycles have run yet.</p>';
            return;
        }
        container.innerHTML = runs.map(r => {
            const status = r.extraction_json
                ? `processed ${r.processed_count}, wrote ${r.written_count}`
                : `deferred ${r.deferred_count} (no extraction — check ANTHROPIC_API_KEY or server logs)`;
            const extraction = r.extraction_json ? `<pre class="log-json">${escapeHtml(JSON.stringify(JSON.parse(r.extraction_json), null, 2))}</pre>` : '';
            return `<div class="log-entry"><div class="diary-meta">${escapeHtml(r.created_at)} — ${escapeHtml(status)}</div>${extraction}</div>`;
        }).join('');
    }

    async function loadInquiries() {
        const container = document.getElementById('logs-inquiries');
        const res = await fetch('/api/psyche/autonomous-inquiries');
        const inquiries = await res.json();
        if (inquiries.length === 0) {
            container.innerHTML = '<p class="empty-note">No autonomous inquiries yet.</p>';
            return;
        }
        container.innerHTML = inquiries.map(i => {
            let topic = '';
            try { const trace = JSON.parse(i.trace_of_derivation); topic = `${trace.driven_by}: "${trace.topic}"`; } catch (e) {}
            return `<div class="log-entry"><div class="diary-meta">${escapeHtml(i.created_at)} — ${escapeHtml(topic)}</div>${escapeHtml(i.content)}</div>`;
        }).join('');
    }

    async function loadReviews() {
        const container = document.getElementById('logs-reviews');
        const res = await fetch('/api/psyche/reviews');
        const reviews = await res.json();
        if (reviews.length === 0) {
            container.innerHTML = '<p class="empty-note">No weekly reviews yet.</p>';
            return;
        }
        container.innerHTML = reviews.map(r => {
            const label = r.review_type === 'weekly_accounting' ? 'Weekly Accounting' : 'Weekly Pattern Review';
            return `<div class="log-entry"><div class="diary-meta">${escapeHtml(r.created_at)} — ${label}</div><pre class="log-json">${escapeHtml(r.content)}</pre></div>`;
        }).join('');
    }

    loadDiaryPart('self', panels.self);
    loadDiaryPart('architect', panels.architect);
    loadDigestRuns();
    loadInquiries();
    loadReviews();
})();
