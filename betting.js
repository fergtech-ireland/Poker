// Always-visible chip tray for betting and raising (no-limit), shared by both pages.
// The amount starts at the minimum bet/raise; each tap on a chip adds that chip's value.
// BetPanel.create(container, onConfirm) -> { update(opt | null) }
//   update(opt) when it's your turn and you can bet or raise; update(null) dims the tray.
//   opt: { min, max, top, isBet, allIn, current }
//     min    smallest legal "bet/raise to" amount (already capped at max)
//     max    largest amount: everything you have (all in)
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
      <div class="chip-row">
        ${CHIPS.map(c => `<button type="button" class="chip chip-${c.name}" data-chip="${c.value}" aria-label="Add a ${c.value} chip"><span>${c.value >= 1000 ? c.value / 1000 + 'K' : c.value}</span></button>`).join('')}
      </div>
      <div class="bet-actions">
        <button type="button" class="secondary bet-clear">Clear</button>
        <button type="button" class="allin bet-allin">All in</button>
        <button type="button" class="bet-confirm">Raise</button>
      </div>`;
    const q = s => container.querySelector(s);
    const confirmBtn = q('.bet-confirm'), allInBtn = q('.bet-allin'), clearBtn = q('.bet-clear');
    let opt = null, amount = 0, key = '';

    function render() {
      container.classList.toggle('off', !opt);
      if (!opt) {
        for (const b of container.querySelectorAll('button')) b.disabled = true;
        confirmBtn.textContent = 'Raise';
        allInBtn.textContent = 'All in';
        return;
      }
      for (const b of container.querySelectorAll('[data-chip]')) b.disabled = amount + Number(b.dataset.chip) > opt.max;
      clearBtn.disabled = amount === opt.min;
      allInBtn.disabled = amount === opt.max;
      allInBtn.textContent = opt.allIn ? 'All in' : 'Max';
      confirmBtn.disabled = false;
      confirmBtn.textContent = amount === opt.max && opt.allIn ? `All in ${fmt(amount)}`
        : `${opt.isBet ? 'Bet' : 'Raise to'} ${fmt(amount)}`;
    }

    container.addEventListener('click', e => {
      const chip = e.target.closest('[data-chip]');
      if (!chip || chip.disabled || !opt) return;
      amount = Math.min(opt.max, amount + Number(chip.dataset.chip));
      chip.classList.remove('pop'); void chip.offsetWidth; chip.classList.add('pop');
      render();
    });
    clearBtn.onclick = () => { if (opt) { amount = opt.min; render(); } };
    allInBtn.onclick = () => { if (opt) { amount = opt.max; render(); } };
    confirmBtn.onclick = () => { if (opt) { const v = amount; update(null); onConfirm(v); } };

    // Keep the chosen amount while the same decision is on screen; start again at the minimum for a new one.
    function update(o) {
      const k = o ? `${o.min}|${o.max}|${o.top}|${o.current}` : '';
      if (o && k !== key) amount = o.min;
      key = k;
      opt = o;
      render();
    }
    update(null);
    return { update };
  }

  root.BetPanel = { create, CHIPS };
})(window);
