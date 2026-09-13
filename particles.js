(() => {
  const canvas = document.querySelector('#tech-particles');
  const ctx = canvas?.getContext('2d');
  if (!ctx) return;

  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const hover = matchMedia('(any-hover: hover)');
  const particles = [];
  const maxParticles = 80;
  let frame = 0;
  let lastTime = 0;
  let lastPointer = null;
  let width = 0;
  let height = 0;

  function reset() {
    cancelAnimationFrame(frame);
    frame = 0;
    lastTime = 0;
    lastPointer = null;
    particles.length = 0;
    ctx.clearRect(0, 0, width, height);
  }

  function resize() {
    reset();
    width = innerWidth;
    height = innerHeight;
    const ratio = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function allowed() {
    return !motion.matches && hover.matches && !document.hidden && !document.body.classList.contains('portal-open');
  }

  function draw(now) {
    frame = 0;
    if (!allowed()) { reset(); return; }
    const dt = Math.min((now - (lastTime || now)) / 1000, .05);
    lastTime = now;
    ctx.clearRect(0, 0, width, height);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const alpha = p.life / p.duration;
      ctx.strokeStyle = `rgba(115,226,248,${alpha * .65})`;
      ctx.fillStyle = `rgba(164,247,255,${alpha * .85})`;
      ctx.lineWidth = .8;
      if (p.shape === 0) {
        ctx.strokeRect(p.x - p.size, p.y - p.size, p.size * 2, p.size * 2);
      } else if (p.shape === 1) {
        ctx.beginPath();
        ctx.moveTo(p.x - p.size * 2, p.y);
        ctx.lineTo(p.x + p.size * 2, p.y);
        ctx.moveTo(p.x, p.y - p.size * 2);
        ctx.lineTo(p.x, p.y + p.size * 2);
        ctx.stroke();
      } else {
        ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
      }
      // Nearby trail nodes form short circuit-like right-angle connectors.
      const next = particles[i + 1];
      if (next && Math.hypot(p.x - next.x, p.y - next.y) < 46) {
        ctx.strokeStyle = `rgba(80,190,230,${Math.min(alpha, next.life / next.duration) * .25})`;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(next.x, p.y);
        ctx.lineTo(next.x, next.y);
        ctx.stroke();
      }
    }
    // Idle pages do not run an empty animation loop.
    if (particles.length) frame = requestAnimationFrame(draw);
    else lastTime = 0;
  }

  function spawn(x, y) {
    const duration = .6 + Math.random() * .65;
    particles.push({
      x: x + (Math.random() - .5) * 18,
      y: y + (Math.random() - .5) * 18,
      vx: (Math.random() - .5) * 22,
      vy: -10 - Math.random() * 17,
      size: 1.2 + Math.random() * 1.8,
      shape: Math.floor(Math.random() * 3),
      life: duration,
      duration,
    });
    if (particles.length > maxParticles) particles.shift();
  }

  document.addEventListener('pointermove', event => {
    if (!allowed() || event.pointerType === 'touch') { lastPointer = null; return; }
    const current = { x: event.clientX, y: event.clientY };
    const previous = lastPointer || current;
    const distance = Math.hypot(current.x - previous.x, current.y - previous.y);
    if (lastPointer && distance < 5) return;
    const steps = Math.min(6, Math.max(1, Math.floor(distance / 10)));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      spawn(previous.x + (current.x - previous.x) * t, previous.y + (current.y - previous.y) * t);
    }
    lastPointer = current;
    if (!frame) frame = requestAnimationFrame(draw);
  }, { passive: true });

  document.addEventListener('pointerleave', () => { lastPointer = null; });
  document.addEventListener('visibilitychange', () => {
    document.body.classList.toggle('motion-paused', document.hidden);
    if (document.hidden) reset();
  });
  window.addEventListener('resize', resize);
  window.addEventListener('pagehide', reset);
  motion.addEventListener('change', reset);
  hover.addEventListener('change', reset);
  resize();
})();
