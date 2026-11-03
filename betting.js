// Bet sizing shared by both pages (no-limit), in the usual poker-app layout:
//   chips row        [5] [25] [100] [500] [1K]       values grow with the big blind
//   quick sizes      [Clear] [½ Pot] [Pot] [All in]
//   action row       Fold | Call | Raise to X        (the page's own buttons; this module drives Raise)
// The amount starts at the minimum bet/raise; each tap on a chip adds that chip's value.
//
// BetPanel.create(container, raiseBtn, onConfirm) -> { update(opt | null) }
//   update(opt) when it's your turn and you can bet or raise; update(null) dims the chips.
//   opt: { min, max, top, current, pot, isBet, allIn, bb }
//     min/max  smallest legal "bet/raise to" amount / everything you have
//     top      the current highest bet this round; current = what you've put in this round
//     pot      all chips in the pot, including this round's bets
//     bb       the big blind, which sets the chip values
//   onConfirm(amount) is called with the chosen "bet/raise to" amount.
(function (root) {
  const COLOURS = ['red', 'green', 'black', 'purple', 'yellow'];
  // Real casino chip denominations to pick from.
  const DENOMS = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000];
  const MULTIPLES = [0.25, 1, 5, 25, 50]; // of the big blind

  // The five chip values for a big blind: the nearest casino denominations to ¼, 1, 5, 25 and 50 big blinds.
  function chipValues(bb) {
    const out = [];
    for (const m of MULTIPLES) {
      const target = bb * m;
      let best = DENOMS.find(d => d > (out[out.length - 1] || 0));
      for (const d of DENOMS) {
        if (d <= (out[out.length - 1] || 0)) continue;
        if (Math.abs(Math.log(d / target)) < Math.abs(Math.log(best / target))) best = d;
      }
      out.push(best);
    }
    return out;
  }

  const fmt = n => n.toLocaleString('en-IE');
  const short = n => (n >= 1e6 ? n / 1e6 + 'M' : n >= 1000 ? n / 1000 + 'K' : String(n));

  function create(container, raiseBtn, onConfirm) {
    container.classList.add('bet-panel');
    container.innerHTML = `
      <div class="chip-row"></div>
      <div class="bet-quick">
        <button type="button" class="secondary bet-clear">Clear</button>
        <button type="button" class="secondary bet-half">½ Pot</button>
        <button type="button" class="secondary bet-pot">Pot</button>
        <button type="button" class="allin bet-allin">All in</button>
      </div>`;
    const q = s => container.querySelector(s);
    const chipRow = q('.chip-row');
    let opt = null, amount = 0, key = '', chipsFor = 0;

    function drawChips(bb) {
      if (bb === chipsFor) return;
      chipsFor = bb;
      chipRow.innerHTML = chipValues(bb).map((v, i) =>
        `<button type="button" class="chip chip-${COLOURS[i]}" data-chip="${v}" aria-label="Add a ${fmt(v)} chip"><span>${short(v)}</span></button>`).join('');
    }

    // Pot-sized raises: call first, then raise by the whole (or half the) pot. Rounded to the smallest chip.
    function potSize(fraction) {
      const unit = chipValues(opt.bb)[0];
      const potAfterCall = opt.pot + Math.max(0, opt.top - (opt.current || 0));
      const v = Math.round((opt.top + potAfterCall * fraction) / unit) * unit;
      return Math.min(opt.max, Math.max(opt.min, v));
    }

    function render() {
      container.classList.toggle('off', !opt);
      if (!opt) {
        for (const b of container.querySelectorAll('button')) b.disabled = true;
        raiseBtn.disabled = true;
        raiseBtn.textContent = 'Raise';
        return;
      }
      for (const b of container.querySelectorAll('[data-chip]')) b.disabled = amount + Number(b.dataset.chip) > opt.max;
      q('.bet-clear').disabled = amount === opt.min;
      q('.bet-half').disabled = potSize(0.5) === amount;
      q('.bet-pot').disabled = potSize(1) === amount;
      q('.bet-allin').disabled = amount === opt.max;
      q('.bet-allin').textContent = opt.allIn ? 'All in' : 'Max';
      raiseBtn.disabled = false;
      raiseBtn.textContent = amount === opt.max && opt.allIn ? `All in ${fmt(amount)}`
        : `${opt.isBet ? 'Bet' : 'Raise to'} ${fmt(amount)}`;
    }

    container.addEventListener('click', e => {
      if (!opt) return;
      const b = e.target.closest('button');
      if (!b || b.disabled) return;
      if (b.dataset.chip) {
        amount = Math.min(opt.max, amount + Number(b.dataset.chip));
        b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
      } else if (b.classList.contains('bet-clear')) amount = opt.min;
      else if (b.classList.contains('bet-half')) amount = potSize(0.5);
      else if (b.classList.contains('bet-pot')) amount = potSize(1);
      else if (b.classList.contains('bet-allin')) amount = opt.max;
      render();
    });
    raiseBtn.addEventListener('click', () => {
      if (!opt) return;
      const v = amount;
      update(null);
      onConfirm(v);
    });

    // Keep the chosen amount while the same decision is on screen; start again at the minimum for a new one.
    function update(o) {
      if (o) drawChips(o.bb || 20);
      const k = o ? `${o.min}|${o.max}|${o.top}|${o.current}` : '';
      if (o && k !== key) amount = o.min;
      key = k;
      opt = o;
      render();
    }
    drawChips(20);
    update(null);
    return { update };
  }

  const api = { create, chipValues };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.BetPanel = api;
})(typeof window !== 'undefined' ? window : null);
