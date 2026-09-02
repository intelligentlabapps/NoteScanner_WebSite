(() => {
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarsePointer = window.matchMedia('(hover: none) and (pointer: coarse)').matches;
  const mobileViewport = coarsePointer && window.matchMedia('(max-width: 991.98px)').matches;
  const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));

  // Lightweight hero depth motion.
  const stage = document.querySelector('.motion-stage');
  if (stage && !reducedMotion && !coarsePointer) {
    let targetX = 0, targetY = 0, x = 0, y = 0;
    const setTarget = (clientX, clientY) => {
      targetX = (clientX / innerWidth - .5) * 9;
      targetY = (clientY / innerHeight - .5) * 7;
    };
    window.addEventListener('pointermove', e => setTarget(e.clientX, e.clientY), { passive: true });
    const tick = () => {
      x += (targetX - x) * .055;
      y += (targetY - y) * .055;
      stage.style.transform = `translate3d(${x * .18}px, ${y * .18}px, 0)`;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  const sections = [...document.querySelectorAll('main > section.hero-shell, main > section.section-shell')];
  let sectionFrameRequested = false;
  let activeIndex = 0;

  // GPU-friendly window morph: entering section is slightly zoomed out, becomes 1x at focus,
  // then returns to slightly zoomed out when leaving. Works for auto and manual scrolling.
  const updateSectionWindows = () => {
    sectionFrameRequested = false;
    if (!sections.length || reducedMotion) return;
    const vh = Math.max(1, window.innerHeight);
    const viewportCenter = vh * .5;
    let bestIndex = 0;
    let bestDistance = Infinity;

    sections.forEach((section, index) => {
      const rect = section.getBoundingClientRect();
      const sectionCenter = rect.top + rect.height * .5;
      const distance = Math.abs(sectionCenter - viewportCenter);
      if (distance < bestDistance) { bestDistance = distance; bestIndex = index; }

      // Taller sections remain fully focused while viewport center is inside them.
      const centerInside = rect.top <= viewportCenter && rect.bottom >= viewportCenter;
      const edgeDistance = centerInside ? 0 : Math.min(Math.abs(rect.top - viewportCenter), Math.abs(rect.bottom - viewportCenter));
      const normalized = clamp(1 - edgeDistance / (vh * .78));
      const focus = 1 - Math.pow(1 - normalized, 2.35);
      // Mobile uses a narrower transform range. This keeps the zoom effect while avoiding
      // repeated sub-pixel text rasterization on touch GPUs.
      const minScale = mobileViewport ? .985 : .955;
      const minOpacity = mobileViewport ? .90 : .76;
      const maxShift = mobileViewport ? 4 : 10;
      const scale = minScale + focus * (1 - minScale);
      const opacity = minOpacity + focus * (1 - minOpacity);
      const translateY = (1 - focus) * (rect.top < viewportCenter ? -maxShift : maxShift);

      section.style.setProperty('--window-scale', scale.toFixed(4));
      section.style.setProperty('--window-opacity', opacity.toFixed(4));
      section.style.setProperty('--window-shift', `${translateY.toFixed(2)}px`);
      section.style.setProperty('--window-glow', focus.toFixed(4));
      section.classList.toggle('window-focused', focus > .965);
    });
    activeIndex = bestIndex;
  };

  const requestWindowUpdate = () => {
    if (!sectionFrameRequested) {
      sectionFrameRequested = true;
      requestAnimationFrame(updateSectionWindows);
    }
  };
  window.addEventListener('scroll', requestWindowUpdate, { passive: true });
  window.addEventListener('resize', requestWindowUpdate, { passive: true });
  updateSectionWindows();

  // Smooth guided tour. The first cover → features move is intentionally faster.
  if (sections.length && !reducedMotion) {
    let cancelled = false;
    let timer = 0;
    let scrollFrame = 0;
    let autoScrolling = false;

    const ease = t => t < .5
      ? 4 * t * t * t
      : 1 - Math.pow(-2 * t + 2, 3) / 2;

    const cancelTour = () => {
      if (cancelled) return;
      cancelled = true;
      document.body.classList.remove('auto-tour-active', 'section-morphing');
      if (timer) clearTimeout(timer);
      if (scrollFrame) cancelAnimationFrame(scrollFrame);
      timer = 0;
      scrollFrame = 0;
      autoScrolling = false;
      // Recalculate once at the exact stopped position so no stale fractional transform
      // remains after a touch interruption.
      requestAnimationFrame(updateSectionWindows);
    };

    // Genuine scrolling/navigation intent cancels the automatic tour.
    window.addEventListener('wheel', cancelTour, { passive: true, once: true });
    if (!coarsePointer) {
      window.addEventListener('touchmove', cancelTour, { passive: true, once: true });
    }

    // On phones, a deliberate press-and-hold cancels auto movement without forcing the
    // browser to keep compositing all decorative hero animations under a stationary finger.
    if (coarsePointer) {
      let holdTimer = 0;
      let touchActive = false;
      const endHold = () => {
        touchActive = false;
        if (holdTimer) clearTimeout(holdTimer);
        holdTimer = 0;
        requestAnimationFrame(() => {
          document.body.classList.remove('mobile-touch-hold');
          updateSectionWindows();
        });
      };
      window.addEventListener('touchstart', () => {
        touchActive = true;
        if (holdTimer) clearTimeout(holdTimer);
        holdTimer = window.setTimeout(() => {
          if (!touchActive) return;
          document.body.classList.add('mobile-touch-hold');
          cancelTour();
        }, 140);
      }, { passive: true });
      window.addEventListener('touchmove', () => {
        if (!cancelled) cancelTour();
      }, { passive: true });
      window.addEventListener('touchend', endHold, { passive: true });
      window.addEventListener('touchcancel', endHold, { passive: true });
    }
    window.addEventListener('keydown', e => {
      if (['ArrowDown','ArrowUp','PageDown','PageUp','Home','End',' '].includes(e.key)) cancelTour();
    });

    const smoothScrollTo = (targetY, duration, done) => {
      const startY = window.scrollY;
      const delta = targetY - startY;
      const start = performance.now();
      autoScrolling = true;
      document.body.classList.add('section-morphing');

      const step = now => {
        if (cancelled) return;
        const t = clamp((now - start) / duration);
        window.scrollTo(0, startY + delta * ease(t));
        // Update zoom variables in the same animation frame instead of a separate expensive effect.
        updateSectionWindows();
        if (t < 1) {
          scrollFrame = requestAnimationFrame(step);
        } else {
          autoScrolling = false;
          document.body.classList.remove('section-morphing');
          done?.();
        }
      };
      scrollFrame = requestAnimationFrame(step);
    };

    const queueNext = () => {
      if (cancelled || activeIndex >= sections.length - 1) return;
      const firstMove = activeIndex === 0;
      const delay = firstMove ? 2600 : 5000;
      const duration = firstMove ? 690 : 1220;
      timer = setTimeout(() => {
        if (cancelled) return;
        const nextIndex = Math.min(activeIndex + 1, sections.length - 1);
        const y = sections[nextIndex].getBoundingClientRect().top + window.scrollY;
        activeIndex = nextIndex;
        smoothScrollTo(y, duration, () => {
          if (activeIndex < sections.length - 1) queueNext();
          else cancelTour();
        });
      }, delay);
    };

    document.body.classList.add('auto-tour-active');
    queueNext();
  }

  // Scroll-reveal animation.
  const revealItems = [...document.querySelectorAll('.reveal-up')];
  if (reducedMotion || !('IntersectionObserver' in window)) {
    revealItems.forEach(el => el.classList.add('is-visible'));
  } else {
    const revealObserver = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          revealObserver.unobserve(entry.target);
        }
      });
    }, { threshold: .12, rootMargin: '0px 0px -5% 0px' });
    revealItems.forEach(el => revealObserver.observe(el));
  }

  // Feature carousel keeps looping even while the user scrolls/taps elsewhere.
  const slider = document.querySelector('[data-slider]');
  if (slider) {
    const slides = [...slider.querySelectorAll('[data-slide]')];
    const copies = [...slider.querySelectorAll('[data-copy]')];
    const dots = [...slider.querySelectorAll('[data-dot]')];
    const count = slider.querySelector('[data-slide-count]');
    const progress = slider.querySelector('.slider-progress span');
    const prev = slider.querySelector('[data-prev]');
    const next = slider.querySelector('[data-next]');
    let index = 0;
    let timer = null;
    const intervalMs = 5600;

    const restartProgress = () => {
      if (!progress || reducedMotion) return;
      progress.style.animation = 'none';
      void progress.offsetWidth;
      progress.style.animation = `progress-fill ${intervalMs / 1000}s linear infinite`;
    };
    const show = newIndex => {
      index = (newIndex + slides.length) % slides.length;
      slides.forEach((el, i) => el.classList.toggle('is-active', i === index));
      copies.forEach((el, i) => el.classList.toggle('is-active', i === index));
      dots.forEach((el, i) => {
        const active = i === index;
        el.classList.toggle('is-active', active);
        el.setAttribute('aria-selected', active ? 'true' : 'false');
      });
      if (count) count.textContent = `${String(index + 1).padStart(2, '0')} / ${String(slides.length).padStart(2, '0')}`;
      restartProgress();
    };
    const start = () => {
      if (timer) clearInterval(timer);
      if (!reducedMotion) timer = setInterval(() => show(index + 1), intervalMs);
    };
    const interact = nextIndex => { show(nextIndex); start(); };
    prev?.addEventListener('click', () => interact(index - 1));
    next?.addEventListener('click', () => interact(index + 1));
    dots.forEach((dot, i) => dot.addEventListener('click', () => interact(i)));

    let touchStartX = null;
    slider.addEventListener('touchstart', e => { touchStartX = e.touches[0]?.clientX ?? null; }, { passive: true });
    slider.addEventListener('touchend', e => {
      if (touchStartX == null) return;
      const endX = e.changedTouches[0]?.clientX ?? touchStartX;
      const dx = endX - touchStartX;
      if (Math.abs(dx) > 42) interact(index + (dx < 0 ? 1 : -1));
      touchStartX = null;
    }, { passive: true });

    show(0);
    start();
  }
})();
