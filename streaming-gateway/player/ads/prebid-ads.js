// Local availability probe only. No advertising, tracking or external requests.
window.dispatchEvent(new CustomEvent('watch-support-probe', { detail: document.currentScript?.dataset.probe || '' }));
