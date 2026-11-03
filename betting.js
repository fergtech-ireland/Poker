// Bet / raise chooser shared by both pages (no-limit betting).
// BetPanel.create(container, onConfirm) -> { open(opt), close(), isOpen() }
//   opt: { min, max, top, pot, isBet, allIn }
//     min    smallest legal "bet/raise to" amount (already capped at max)
//     max    largest amount: everything you have (all in)
//     top    the current highest bet this round (0 if nobody has bet)
//     pot    chips in the pot, including bets this round
//     isBet  true when nobody has bet yet this round ("Bet" rather than "Raise to")
//     allIn  true when max puts all your chips in
//   onConfirm(amount) is called with the chosen "bet/raise to" amount.
(function (root) {
  function create(container, onConfirm) {
    container.classList.add('bet-panel');
    container.innerHTML = `
      <div class="bet-top">
        <span class="bet-label"></span>
        <input type="number" class="bet-input" inputmode="numeric" aria-label="Bet amount">
      </div>
      <input type="range" class="bet-range" aria-label="Bet amount slider">
      <div class="bet-presets"></div>
      <div class="bet-actions">
        <button type="button" class="secondary bet-cancel">Cancel</button>
        <button type="button" class="primary bet-confirm"></button>
      </div>
      <div class="bet-hint"></div>`;
    const q = s => container.querySelector(s);
    const input = q('.bet-input'), range = q('.bet-range'), confirmBtn = q('.bet-confirm');
    let opt = null, amount = 0;

    const valid = v => Number.isInteger(v) && v <= opt.max && (v >= opt.min || v === opt.max);
    const word = () => (opt.isBet ? 'Bet' : 'Raise to');

    function set(v, fromInput) {
      amount = v;
      if (!fromInput) input.value = v;
      range.value = Math.min(Math.max(v, opt.min), opt.max);
      const ok = valid(v);
      confirmBtn.disabled = !ok;
      confirmBtn.textContent = !ok ? word() : v === opt.max && opt.allIn ? `All in (${v})` : `${word()} ${v}`;
      q('.bet-hint').textContent = ok ? '' : v > opt.max
        ? `You can bet at most ${opt.max}.`
        : `The minimum is ${opt.min}${opt.allIn ? `, or go all in for ${opt.max}` : ''}.`;
      for (const b of container.querySelectorAll('.bet-presets button')) b.classList.toggle('active', +b.dataset.v === v);
    }

    // Round slider and preset amounts to tidy numbers (but never past the limits).
    const step = () => (opt.max - opt.min >= 200 ? 10 : 5);
    const tidy = v => Math.min(opt.max, Math.max(opt.min, Math.round(v / step()) * step()));

    function presets() {
      const list = [['Min', opt.min]];
      const potAfterCall = opt.pot + Math.max(0, opt.top - (opt.current || 0));
      const half = tidy(opt.top + potAfterCall / 2), full = tidy(opt.top + potAfterCall);
      if (half > opt.min && half < opt.max) list.push(['½ Pot', half]);
      if (full > opt.min && full < opt.max && full !== half) list.push(['Pot', full]);
      list.push([opt.allIn ? 'All in' : 'Max', opt.max]);
      return list.filter((p, i, a) => a.findIndex(x => x[1] === p[1]) === i);
    }

    input.addEventListener('input', () => set(Math.floor(Number(input.value)), true));
    range.addEventListener('input', () => {
      const v = Number(range.value);
      set(v >= opt.max ? opt.max : v <= opt.min ? opt.min : tidy(v));
    });
    q('.bet-presets').addEventListener('click', e => {
      const b = e.target.closest('button');
      if (b) set(+b.dataset.v);
    });
    q('.bet-cancel').onclick = () => close();
    confirmBtn.onclick = () => { if (valid(amount)) { const v = amount; close(); onConfirm(v); } };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') confirmBtn.click(); });

    function open(o) {
      opt = o;
      q('.bet-label').textContent = opt.isBet ? 'Bet' : 'Raise to';
      range.min = opt.min; range.max = opt.max; range.step = 1;
      input.min = opt.min; input.max = opt.max;
      q('.bet-presets').innerHTML = presets().map(([label, v]) =>
        `<button type="button" class="secondary${label === 'All in' ? ' allin' : ''}" data-v="${v}">${label}</button>`).join('');
      set(opt.min);
      container.hidden = false;
      container.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    function close() { container.hidden = true; opt = null; }
    return { open, close, isOpen: () => !container.hidden };
  }

  root.BetPanel = { create };
})(window);
