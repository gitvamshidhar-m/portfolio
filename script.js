/**
 * VAMSHIDHAR REDDY M - ADVANCED PORTFOLIO INTERACTIVITY
 * Premium, Immersive, Performance-Optimized
 */

(function() {
    'use strict';

    const navbar = document.getElementById('navbar');
    const navToggle = document.getElementById('navToggle');
    const navMenu = document.getElementById('navMenu');
    const themeToggle = document.getElementById('themeToggle');
    const backToTop = document.getElementById('backToTop');
    const typewriter = document.getElementById('typewriter');
    const scrollProgress = document.getElementById('scrollProgress');
    const profileImage = document.getElementById('profileImage');
    const profileFallback = document.getElementById('profileFallback');
    const loadingScreen = document.getElementById('loadingScreen');
    const loadingBarFill = document.getElementById('loadingBarFill');
    const cursorDot = document.getElementById('cursorDot');
    const cursorRing = document.getElementById('cursorRing');
    const particleCanvas = document.getElementById('particleCanvas');

    // ===== LOADING SCREEN =====
    const simulateLoading = () => {
        let progress = 0;
        const interval = setInterval(() => {
            progress += Math.random() * 25 + 15;
            if (progress >= 100) {
                progress = 100;
                clearInterval(interval);
                if (loadingBarFill) loadingBarFill.style.width = '100%';
                setTimeout(() => {
                    if (loadingScreen) loadingScreen.classList.add('hidden');
                    initAnimations();
                }, 200);
            } else {
                if (loadingBarFill) loadingBarFill.style.width = progress + '%';
            }
        }, 60);
    };

    // ===== CUSTOM CURSOR =====
    let mouseX = 0, mouseY = 0, ringX = 0, ringY = 0;
    const isTouchDevice = window.matchMedia('(pointer: coarse)').matches;

    if (!isTouchDevice && cursorDot && cursorRing) {
        let cursorStarted = false;

        document.addEventListener('mousemove', (e) => {
            mouseX = e.clientX;
            mouseY = e.clientY;
            cursorDot.style.left = mouseX + 'px';
            cursorDot.style.top = mouseY + 'px';

            if (!cursorStarted) {
                // First real mouse position we've seen — snap the ring straight
                // to it (instead of lerping in from the stale 0,0 origin) and
                // reveal both elements now that they have a real position.
                cursorStarted = true;
                ringX = mouseX;
                ringY = mouseY;
                cursorDot.classList.add('active');
                cursorRing.classList.add('active');
            }
        });

        const animateRing = () => {
            ringX += (mouseX - ringX) * 0.15;
            ringY += (mouseY - ringY) * 0.15;
            cursorRing.style.left = ringX + 'px';
            cursorRing.style.top = ringY + 'px';
            requestAnimationFrame(animateRing);
        };
        animateRing();

        // Hover effects on interactive elements
        const interactiveElements = document.querySelectorAll('a, button, .project-link, .social-link, .social-btn, .magnetic-btn');
        interactiveElements.forEach(el => {
            el.addEventListener('mouseenter', () => {
                cursorDot.classList.add('hovering');
                cursorRing.classList.add('hovering');
            });
            el.addEventListener('mouseleave', () => {
                cursorDot.classList.remove('hovering');
                cursorRing.classList.remove('hovering');
            });
        });
    }

    // ===== PARTICLE SYSTEM =====
    const initParticles = () => {
        if (!particleCanvas) return;
        const ctx = particleCanvas.getContext('2d');
        let particles = [];
        let animationId;
        let w, h;

        const resize = () => {
            const hero = document.querySelector('.hero');
            if (!hero) return;
            w = particleCanvas.width = hero.offsetWidth;
            h = particleCanvas.height = hero.offsetHeight;
        };

        class Particle {
            constructor() {
                this.x = Math.random() * w;
                this.y = Math.random() * h;
                this.vx = (Math.random() - 0.5) * 0.5;
                this.vy = (Math.random() - 0.5) * 0.5;
                this.size = Math.random() * 2 + 1;
                this.opacity = Math.random() * 0.5 + 0.2;
            }
            update() {
                this.x += this.vx;
                this.y += this.vy;
                if (this.x < 0 || this.x > w) this.vx *= -1;
                if (this.y < 0 || this.y > h) this.vy *= -1;
            }
            draw() {
                ctx.beginPath();
                ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(99, 102, 241, ${this.opacity})`;
                ctx.fill();
            }
        }

        const init = () => {
            resize();
            particles = [];
            const count = Math.min(80, Math.floor((w * h) / 15000));
            for (let i = 0; i < count; i++) particles.push(new Particle());
        };

        const animate = () => {
            ctx.clearRect(0, 0, w, h);
            particles.forEach((p, i) => {
                p.update();
                p.draw();
                // Draw connections
                for (let j = i + 1; j < particles.length; j++) {
                    const dx = p.x - particles[j].x;
                    const dy = p.y - particles[j].y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < 120) {
                        ctx.beginPath();
                        ctx.moveTo(p.x, p.y);
                        ctx.lineTo(particles[j].x, particles[j].y);
                        ctx.strokeStyle = `rgba(99, 102, 241, ${0.1 * (1 - dist / 120)})`;
                        ctx.lineWidth = 0.5;
                        ctx.stroke();
                    }
                }
            });
            animationId = requestAnimationFrame(animate);
        };

        init();
        animate();
        window.addEventListener('resize', () => {
            init();
            if (!animationId) animate();
        });

        // Pause when not visible
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    if (!animationId) animate();
                } else {
                    cancelAnimationFrame(animationId);
                    animationId = null;
                }
            });
        });
        observer.observe(particleCanvas);
    };

    // ===== MAGNETIC BUTTONS =====
    const initMagneticButtons = () => {
        if (isTouchDevice) return;
        const buttons = document.querySelectorAll('.magnetic-btn');
        buttons.forEach(btn => {
            btn.addEventListener('mousemove', (e) => {
                const rect = btn.getBoundingClientRect();
                const x = e.clientX - rect.left - rect.width / 2;
                const y = e.clientY - rect.top - rect.height / 2;
                btn.style.transform = `translate(${x * 0.3}px, ${y * 0.3}px)`;
            });
            btn.addEventListener('mouseleave', () => {
                btn.style.transform = 'translate(0, 0)';
            });
        });
    };

    // ===== 3D TILT CARDS =====
    const initTiltCards = () => {
        if (isTouchDevice) return;
        const cards = document.querySelectorAll('.tilt-card');
        cards.forEach(card => {
            // Avoid attaching listeners more than once when re-init runs
            if (card.dataset.tiltInit === '1') return;
            card.dataset.tiltInit = '1';

            card.addEventListener('mousemove', (e) => {
                const rect = card.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                const centerX = rect.width / 2;
                const centerY = rect.height / 2;
                const rotateX = (y - centerY) / 20;
                const rotateY = (centerX - x) / 20;
                card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) scale3d(1.02, 1.02, 1.02)`;
                card.style.setProperty('--mouse-x', `${x}px`);
                card.style.setProperty('--mouse-y', `${y}px`);
            });
            card.addEventListener('mouseleave', () => {
                card.style.transform = 'perspective(1000px) rotateX(0) rotateY(0) scale3d(1, 1, 1)';
            });
        });
    };
    // Expose so enhancements.js can re-apply after injecting new .tilt-card elements
    window.__reinitTilt = initTiltCards;

    // ===== SCROLL REVEAL ANIMATIONS =====
    const initScrollReveal = () => {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    const delay = entry.target.dataset.delay || 0;
                    setTimeout(() => {
                        entry.target.classList.add('animated');
                    }, parseInt(delay, 10));
                    observer.unobserve(entry.target);
                }
            });
        }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

        document.querySelectorAll('[data-animate]').forEach(el => observer.observe(el));
    };

    // ===== THEME =====
    const getPreferredTheme = () => {
        const saved = localStorage.getItem('theme');
        if (saved) return saved;
        return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    };

    const setTheme = (theme) => {
        document.documentElement.setAttribute('data-theme', theme);
        try { localStorage.setItem('theme', theme); } catch (e) { /* localStorage may be unavailable */ }
        if (themeToggle) {
            const icon = themeToggle.querySelector('i');
            if (icon) icon.className = theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
        }
    };

    if (themeToggle) {
        setTheme(getPreferredTheme());
        themeToggle.addEventListener('click', () => {
            const current = document.documentElement.getAttribute('data-theme');
            setTheme(current === 'dark' ? 'light' : 'dark');
        });
    } else {
        // Still apply the preferred theme even if the toggle button is absent
        setTheme(getPreferredTheme());
    }

    // ===== MOBILE NAV =====
    if (navToggle && navMenu) {
        navToggle.addEventListener('click', () => {
            navToggle.classList.toggle('active');
            navMenu.classList.toggle('active');
        });
    }

    document.querySelectorAll('.nav-link').forEach(link => {
        link.addEventListener('click', () => {
            if (navToggle) navToggle.classList.remove('active');
            if (navMenu) navMenu.classList.remove('active');
        });
    });

    // ===== ACTIVE NAV LINK =====
    const sections = document.querySelectorAll('section[id]');
    const navLinks = document.querySelectorAll('.nav-link');

    const updateActiveNav = () => {
        if (!navLinks.length) return;
        const navHeight = navbar ? navbar.offsetHeight : 72;
        const scrollPos = window.scrollY + navHeight + 100;
        let currentSection = 'home';
        sections.forEach(section => {
            const sectionTop = section.offsetTop;
            const sectionHeight = section.offsetHeight;
            const sectionId = section.getAttribute('id');
            if (scrollPos >= sectionTop && scrollPos < sectionTop + sectionHeight) {
                currentSection = sectionId;
            }
        });
        if (window.scrollY < 50) currentSection = 'home';
        navLinks.forEach(link => {
            link.classList.remove('active');
            if (link.getAttribute('href') === '#' + currentSection) {
                link.classList.add('active');
            }
        });
    };

    // ===== NAVBAR SCROLL =====
    const handleNavbarScroll = () => {
        if (!navbar) return;
        if (window.scrollY > 50) navbar.classList.add('scrolled');
        else navbar.classList.remove('scrolled');
    };

    // ===== TYPEWRITER =====
    const typewriterTexts = [
        'AI-Powered Digital Marketing',
        'Growth Marketing Expert',
        'Performance Marketing Pro',
        'SEO & PPC Specialist',
        'AI Developer & Builder'
    ];
    let typeIndex = 0, charIndex = 0, isDeleting = false, typeSpeed = 100;

    const typeWriter = () => {
        if (!typewriter) return;
        const currentText = typewriterTexts[typeIndex];
        if (isDeleting) {
            typewriter.textContent = currentText.substring(0, charIndex - 1);
            charIndex--; typeSpeed = 50;
        } else {
            typewriter.textContent = currentText.substring(0, charIndex + 1);
            charIndex++; typeSpeed = 100;
        }
        if (!isDeleting && charIndex === currentText.length) {
            isDeleting = true; typeSpeed = 2000;
        } else if (isDeleting && charIndex === 0) {
            isDeleting = false;
            typeIndex = (typeIndex + 1) % typewriterTexts.length;
            typeSpeed = 500;
        }
        setTimeout(typeWriter, typeSpeed);
    };
    if (typewriter) setTimeout(typeWriter, 1500);

    // ===== SCROLL PROGRESS =====
    const updateScrollProgress = () => {
        if (!scrollProgress) return;
        const scrollTop = window.scrollY;
        const docHeight = document.documentElement.scrollHeight - window.innerHeight;
        scrollProgress.style.width = docHeight > 0 ? (scrollTop / docHeight) * 100 + '%' : '0%';
    };

    // ===== COUNTERS =====
    const counters = document.querySelectorAll('.counter');
    let countersAnimated = false;
    const animateCounters = () => {
        const impactSection = document.getElementById('impact');
        if (!impactSection || countersAnimated) return;
        const rect = impactSection.getBoundingClientRect();
        if (rect.top < window.innerHeight) {
            countersAnimated = true;
            counters.forEach((counter, index) => {
                const card = counter.closest('.stat-card');
                if (!card) return;
                const target = parseInt(card.dataset.count, 10);
                if (isNaN(target)) return;
                const duration = 2000;
                setTimeout(() => {
                    const startTime = performance.now();
                    const updateCounter = (currentTime) => {
                        const elapsed = currentTime - startTime;
                        const progress = Math.min(elapsed / duration, 1);
                        const easeOut = 1 - Math.pow(1 - progress, 3);
                        counter.textContent = Math.floor(easeOut * target);
                        if (progress < 1) requestAnimationFrame(updateCounter);
                        else counter.textContent = target;
                    };
                    requestAnimationFrame(updateCounter);
                }, index * 150);
            });
        }
    };

    // ===== SKILL BARS =====
    const skillBars = document.querySelectorAll('.skill-bar-item');
    let skillBarsAnimated = false;
    const animateSkillBars = () => {
        const skillsSection = document.getElementById('skills');
        if (!skillsSection || skillBarsAnimated) return;
        const rect = skillsSection.getBoundingClientRect();
        if (rect.top < window.innerHeight - 100) {
            skillBarsAnimated = true;
            skillBars.forEach((bar, index) => {
                const percent = bar.dataset.percent;
                const fill = bar.querySelector('.skill-bar-fill');
                if (fill) setTimeout(() => { fill.style.width = percent + '%'; }, index * 150);
            });
        }
    };

    // ===== TIMELINE =====
    const timelineProgress = document.getElementById('timelineProgress');
    const animateTimeline = () => {
        if (!timelineProgress) return;
        const rect = timelineProgress.getBoundingClientRect();
        if (rect.top < window.innerHeight && rect.bottom > 0) {
            timelineProgress.classList.add('animate');
        }
    };

    // ===== DURATION CALCULATOR =====
    const calculateDuration = () => {
        const durationEl = document.getElementById('currentDuration');
        if (!durationEl) return;
        const startDate = new Date('2023-05-01');
        const now = new Date();
        let years = now.getFullYear() - startDate.getFullYear();
        let months = now.getMonth() - startDate.getMonth();
        if (months < 0) { years--; months += 12; }
        let text = '';
        if (years > 0) text += years + ' Year' + (years > 1 ? 's' : '');
        if (months > 0) text += (years > 0 ? ' ' : '') + months + ' Month' + (months > 1 ? 's' : '');
        durationEl.textContent = text || 'Just Started';
    };

    // ===== COPYRIGHT YEAR =====
    const updateCopyrightYear = () => {
        const el = document.getElementById('copyrightYear');
        if (el) el.textContent = new Date().getFullYear();
    };

    // ===== BACK TO TOP =====
    const handleBackToTop = () => {
        if (!backToTop) return;
        if (window.scrollY > 500) backToTop.classList.add('visible');
        else backToTop.classList.remove('visible');
    };
    if (backToTop) {
        backToTop.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));
    }

    // ===== SMOOTH SCROLL =====
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            const href = this.getAttribute('href');
            if (href && href.startsWith('#') && href.length > 1) {
                e.preventDefault();
                const target = document.getElementById(href.substring(1));
                if (target) {
                    const navHeight = navbar ? navbar.offsetHeight : 0;
                    window.scrollTo({ top: Math.max(0, target.offsetTop - navHeight - 20), behavior: 'smooth' });
                    navLinks.forEach(link => link.classList.remove('active'));
                    this.classList.add('active');
                    if (navToggle) navToggle.classList.remove('active');
                    if (navMenu) navMenu.classList.remove('active');
                }
            }
        });
    });

    // ===== PROFILE FALLBACK =====
    if (profileImage) {
        profileImage.addEventListener('error', () => {
            profileImage.style.display = 'none';
            if (profileFallback) profileFallback.style.display = 'flex';
        });
    }

    // ===== COMBINED SCROLL HANDLER =====
    let ticking = false;
    const handleScroll = () => {
        if (!ticking) {
            requestAnimationFrame(() => {
                handleNavbarScroll();
                updateActiveNav();
                animateCounters();
                animateSkillBars();
                animateTimeline();
                handleBackToTop();
                updateScrollProgress();
                ticking = false;
            });
            ticking = true;
        }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });

    // ===== KEYBOARD =====
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (navToggle) navToggle.classList.remove('active');
            if (navMenu) navMenu.classList.remove('active');
        }
    });

    // ===== REDUCED MOTION =====
    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (prefersReducedMotion.matches) {
        document.querySelectorAll('.gradient-orb').forEach(orb => { orb.style.animation = 'none'; });
        counters.forEach(counter => {
            const card = counter.closest('.stat-card');
            if (card) counter.textContent = card.dataset.count;
        });
        countersAnimated = true;
        skillBars.forEach(bar => {
            const fill = bar.querySelector('.skill-bar-fill');
            if (fill) fill.style.width = bar.dataset.percent + '%';
        });
        skillBarsAnimated = true;
        document.querySelectorAll('[data-animate]').forEach(el => el.classList.add('animated'));
    }

    // ===== INIT ALL =====
    const init = () => {
        handleNavbarScroll();
        updateActiveNav();
        animateCounters();
        animateSkillBars();
        animateTimeline();
        calculateDuration();
        updateCopyrightYear();
        handleBackToTop();
        updateScrollProgress();
        initParticles();
        initMagneticButtons();
        initTiltCards();
    };

    const initAnimations = () => {
        initScrollReveal();
        // Trigger hero animations immediately
        document.querySelectorAll('#home [data-animate]').forEach(el => {
            const delay = el.dataset.delay || 0;
            setTimeout(() => el.classList.add('animated'), parseInt(delay, 10));
        });
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => {
            simulateLoading();
            init();
        });
    } else {
        simulateLoading();
        init();
    }

})();