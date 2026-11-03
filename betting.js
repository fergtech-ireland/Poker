// Bet / raise chooser shared by both pages (no-limit betting), built around poker chips.
// The amount starts at the minimum bet/raise; each tap on a chip adds that chip's value.
// BetPanel.create(container, onConfirm) -> { open(opt), close(), isOpen() }
//   opt: { min, max, top, pot, isBet, allIn }
//     min    smallest legal "bet/raise to" amount (already capped at max)
//     max    largest amount: everything you have (all in)
//     top    the current highest bet this round (0 if nobody has bet)
//     isBet  true when nobody has bet yet this round ("Bet" rather than "Raise to")
//     allIn  true when max puts all your chips in
//   onConfirm(amount) is called with the chosen "bet/raise to" amount.
(function (root) {
  // Standard casino chip colours.
  const CHIPS = [
    { value: 5, name: 'red' },
    { value: 25, name: 'green' },
    { value: 100, name: 'black' },
    { value: 500, name: 'purple' },
    { value: 1000, name: 'yellow' },
  ];
  const fmt = n => n.toLocaleString('en-IE');

  function create(container, onConfirm) {
    container.classList.add('bet-panel');
    container.innerHTML = `
      <div class="bet-top">
        <span class="bet-label"></span>
        <input type="number" class="bet-input" inputmode="numeric" aria-label="Bet amount">
      </div>
      <div class="bet-stack" aria-live="polite"></div>
      <div class="chip-row">
        ${CHIPS.map(c => `<button type="button" class="chip chip-${c.name}" data-chip="${c.value}" aria-label="Add a ${c.value} chip"><span>${c.value >= 1000 ? c.value / 1000 + 'K' : c.value}</span></button>`).join('')}
      </div>
      <div class="bet-presets">
        <button type="button" class="secondary bet-undo">Undo</button>
        <button type="button" class="secondary bet-reset">Reset</button>
        <button type="button" class="secondary allin bet-allin">All in</button>
      </div>
      <div class="bet-actions">
        <button type="button" class="secondary bet-cancel">Cancel</button>
        <button type="button" class="primary bet-confirm"></button>
      </div>
      <div class="bet-hint"></div>`;
    const q = s => container.querySelector(s);
    const input = q('.bet-input'), confirmBtn = q('.bet-confirm');
    let opt = null, amount = 0, added = []; // chip values tapped, in order

    const valid = v => Number.isInteger(v) && v <= opt.max && (v >= opt.min || v === opt.max);
    const word = () => (opt.isBet ? 'Bet' : 'Raise to');

    function update(fromInput) {
      if (!fromInput) input.value = amount;
      const ok = valid(amount);
      confirmBtn.disabled = !ok;
      confirmBtn.textContent = !ok ? word() : amount === opt.max && opt.allIn ? `All in (${fmt(amount)})` : `${word()} ${fmt(amount)}`;
      q('.bet-hint').textContent = ok ? '' : amount > opt.max
        ? `You can bet at most ${fmt(opt.max)}.`
        : `The minimum is ${fmt(opt.min)}${opt.allIn ? `, or go all in for ${fmt(opt.max)}` : ''}.`;
      // The chips you've added, as little coloured dots, plus the extra over the minimum.
      const extra = amount - opt.min;
      q('.bet-stack').innerHTML = added.length
        ? added.map(v => `<i class="mini chip-${CHIPS.find(c => c.value === v).name}"></i>`).join('') + ` <span>+${fmt(extra)} on top of the minimum</span>`
        : `<span>Minimum ${fmt(opt.min)}. Tap chips to add more.</span>`;
      for (const b of container.querySelectorAll('[data-chip]')) b.disabled = amount + Number(b.dataset.chip) > opt.max;
      q('.bet-undo').disabled = !added.length;
      q('.bet-reset').disabled = amount === opt.min && !added.length;
    }

    container.addEventListener('click', e => {
      const chip = e.target.closest('[data-chip]');
      if (!chip || chip.disabled) return;
      const v = Number(chip.dataset.chip);
      if (!valid(amount)) { amount = opt.min; added = []; } // after a bad typed amount, start again
      amount += v;
      added.push(v);
      chip.classList.remove('pop'); void chip.offsetWidth; chip.classList.add('pop');
      update();
    });
    q('.bet-undo').onclick = () => { if (added.length) { amount -= added.pop(); update(); } };
    q('.bet-reset').onclick = () => { amount = opt.min; added = []; update(); };
    q('.bet-allin').onclick = () => { amount = opt.max; added = []; update(); };
    input.addEventListener('input', () => { amount = Math.floor(Number(input.value)); added = []; update(true); });
    q('.bet-cancel').onclick = () => close();
    confirmBtn.onclick = () => { if (valid(amount)) { const v = amount; close(); onConfirm(v); } };
    input.addEventListener('keydown', e => { if (e.key === 'Enter') confirmBtn.click(); });

    function open(o) {
      opt = o;
      q('.bet-label').textContent = opt.isBet ? 'Bet' : 'Raise to';
      q('.bet-allin').textContent = opt.allIn ? `All in ${fmt(opt.max)}` : `Max ${fmt(opt.max)}`;
      input.min = opt.min; input.max = opt.max;
      amount = opt.min;
      added = [];
      update();
      container.hidden = false;
      container.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
    function close() { container.hidden = true; opt = null; }
    return { open, close, isOpen: () => !container.hidden };
  }

  root.BetPanel = { create, CHIPS };
})(window);
