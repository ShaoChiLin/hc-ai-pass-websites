(() => {
  const body = document.body;
  const hero = document.querySelector('.hero');
  const world = document.querySelector('.world');
  const terminal = document.querySelector('.terminal');
  const enter = document.querySelector('#enter');
  const hit = document.querySelector('#monitor-hit');
  const close = document.querySelector('#close');
  const backdrop = document.querySelector('#portal-backdrop');
  const title = document.querySelector('#services-title');
  const subsidy = document.querySelector('#subsidy-link');
  const background = document.querySelectorAll('.site-header, .hero-copy, .site-footer, .skip-link');
  let opened = false;
  let returnFocus = enter;

  // Project live HTML onto the illustrated screen, keeping all text editable.
  function project(width, height, points) {
    const source = [[0, 0], [width, 0], [width, height], [0, height]];
    const rows = source.flatMap(([x, y], i) => {
      const [u, v] = points[i];
      return [[x, y, 1, 0, 0, 0, -u * x, -u * y, u], [0, 0, 0, x, y, 1, -v * x, -v * y, v]];
    });
    for (let c = 0; c < 8; c++) {
      let pivot = c;
      for (let r = c + 1; r < 8; r++) if (Math.abs(rows[r][c]) > Math.abs(rows[pivot][c])) pivot = r;
      [rows[c], rows[pivot]] = [rows[pivot], rows[c]];
      const divisor = rows[c][c];
      if (Math.abs(divisor) < 1e-10) throw new Error('Invalid monitor geometry');
      for (let k = c; k < 9; k++) rows[c][k] /= divisor;
      for (let r = 0; r < 8; r++) {
        if (r === c) continue;
        const factor = rows[r][c];
        for (let k = c; k < 9; k++) rows[r][k] -= factor * rows[c][k];
      }
    }
    const [a, b, c, d, e, f, g, h] = rows.map(row => row[8]);
    return `matrix3d(${a},${d},0,${g},${b},${e},0,${h},0,0,1,0,${c},${f},0,1)`;
  }

  function layout() {
    const width = Math.min(760, window.innerWidth - 32);
    const height = Math.min(500, window.innerHeight - 60);
    body.style.setProperty('--panel-width', `${width}px`);
    body.style.setProperty('--panel-height', `${height}px`);
    if (opened) {
      terminal.style.transform = `translate(${(window.innerWidth - width) / 2}px,${(window.innerHeight - height) / 2}px)`;
      return;
    }
    // CSS scale animates independently; these coordinates describe the unzoomed scene.
    const heroRect = hero.getBoundingClientRect();
    const translation = new DOMMatrix(getComputedStyle(world).transform);
    const left = heroRect.left + world.offsetLeft + translation.m41;
    const top = heroRect.top + world.offsetTop + translation.m42;
    const scale = world.offsetWidth / 1280;
    const corners = [[681, 216], [802, 261], [834, 473], [724, 486]].map(([x, y]) => [left + x * scale, top + y * scale]);
    terminal.style.transform = project(width, height, corners);
    const minX = Math.min(...corners.map(p => p[0]));
    const maxX = Math.max(...corners.map(p => p[0]));
    const minY = Math.min(...corners.map(p => p[1]));
    const maxY = Math.max(...corners.map(p => p[1]));
    Object.assign(hit.style, { left: `${minX}px`, top: `${minY}px`, width: `${maxX-minX}px`, height: `${maxY-minY}px` });
    hit.style.setProperty('--monitor-polygon', `polygon(${corners.map(([x, y]) => `${x-minX}px ${y-minY}px`).join(',')})`);
  }

  function sync() {
    const next = location.hash === '#services';
    if (next === opened) return;
    opened = next;
    backdrop.hidden = !opened;
    if (opened) backdrop.getBoundingClientRect();
    body.classList.toggle('portal-open', opened);
    terminal.inert = !opened;
    terminal.setAttribute('aria-hidden', String(!opened));
    enter.setAttribute('aria-expanded', String(opened));
    hit.setAttribute('aria-expanded', String(opened));
    hit.hidden = opened;
    close.hidden = !opened;
    background.forEach(element => { element.inert = opened; });
    body.style.overflow = opened ? 'hidden' : '';
    terminal.setAttribute('role', opened ? 'dialog' : 'region');
    if (opened) terminal.setAttribute('aria-modal', 'true');
    else terminal.removeAttribute('aria-modal');
    layout();
    if (opened) title.focus({ preventScroll: true });
    else returnFocus.focus({ preventScroll: true });
  }

  function open(event) {
    event.preventDefault();
    returnFocus = event.currentTarget;
    history.pushState({ zhuqingPortal: true }, '', '#services');
    sync();
  }

  function dismiss() {
    if (history.state?.zhuqingPortal) history.back();
    else {
      history.replaceState(null, '', location.pathname + location.search);
      sync();
    }
  }

  try {
    body.classList.add('enhanced', 'no-transition');
    terminal.inert = true;
    terminal.setAttribute('aria-hidden', 'true');
    hit.hidden = false;
    layout();
    requestAnimationFrame(() => body.classList.remove('no-transition'));
    enter.addEventListener('click', open);
    hit.addEventListener('click', open);
    close.addEventListener('click', dismiss);
    backdrop.addEventListener('click', dismiss);
    window.addEventListener('popstate', sync);
    window.addEventListener('hashchange', sync);
    let pendingLayout = false;
    function updateLayout() {
      if (pendingLayout) return;
      pendingLayout = true;
      requestAnimationFrame(() => {
        pendingLayout = false;
        body.classList.add('no-transition');
        layout();
        terminal.getBoundingClientRect();
        body.classList.remove('no-transition');
      });
    }
    window.addEventListener('resize', updateLayout);
    window.addEventListener('scroll', () => { if (!opened) updateLayout(); }, { passive: true });
    window.addEventListener('pageshow', () => { sync(); updateLayout(); });
    document.addEventListener('keydown', event => {
      if (!opened) return;
      if (event.key === 'Escape') dismiss();
      if (event.key === 'Tab') {
        const focus = document.activeElement;
        if (event.shiftKey && (focus === close || focus === title)) {
          event.preventDefault(); subsidy.focus();
        } else if (!event.shiftKey && focus === subsidy) {
          event.preventDefault(); close.focus();
        }
      }
    });
    sync();
  } catch (error) {
    // Basic service navigation remains available if enhancement is unsupported.
    body.classList.remove('enhanced', 'no-transition');
    terminal.style.transform = '';
    terminal.inert = false;
    terminal.removeAttribute('aria-hidden');
    hit.hidden = true;
    console.warn('使用基本服務選單', error);
  }
})();
