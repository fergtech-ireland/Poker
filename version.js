// Release version and credit, shown small at the foot of every screen (as on Agri-It and Gauntlet).
// Bump VERSION (and add a line to CHANGELOG.md) with each release.
// The deploy workflow fills in the build commit and date.
(function (root) {
  const RELEASE = {
    name: "Texas Hold'em",
    version: '0.6.0',
    company: 'FergTech',
    buildSha: '',   // set by the deploy workflow
    buildDate: '',  // set by the deploy workflow, YYYY-MM-DD
  };

  // "Texas Hold'em v0.5.0 · © 2026 FergTech · Built by FergTech"
  function releaseLine(r = RELEASE) {
    const year = /^\d{4}/.test(r.buildDate) ? r.buildDate.slice(0, 4) : String(new Date().getFullYear());
    return `${r.name} v${r.version} · © ${year} ${r.company} · Built by ${r.company}`;
  }

  // "build abc1234, built 2026-10-31" (empty when running from a local copy)
  function buildLabel(r = RELEASE) {
    return [r.buildSha && `build ${r.buildSha}`, r.buildDate && `built ${r.buildDate}`].filter(Boolean).join(', ');
  }

  const trademarkLine = (r = RELEASE) => `${r.company}™ is a trademark of ${r.company}.`;

  function mount(doc) {
    for (const el of doc.querySelectorAll('[data-release]')) {
      const build = buildLabel();
      el.innerHTML =
        '<div class="fx">FERG<i>TECH</i><sup>™</sup></div>' +
        `<p>${releaseLine()}</p>` +
        (build ? `<p class="build">${build}</p>` : '') +
        `<p>${trademarkLine()}</p>`;
    }
  }

  const api = { RELEASE, releaseLine, buildLabel, trademarkLine };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) {
    root.AppRelease = api;
    if (root.document) {
      if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', () => mount(root.document));
      else mount(root.document);
    }
  }
})(typeof window !== 'undefined' ? window : null);
