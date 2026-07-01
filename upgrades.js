/**
 * PORTFOLIO UPGRADES 2026 - NON-DISRUPTIVE ENHANCEMENTS
 * Adds features without modifying existing functionality
 *
 * Note: Theme toggle, smooth scroll, and scroll-reveal are already
 * handled in script.js — this file only adds truly unique features.
 */

(function() {
  'use strict';

  /* ════════════════════════════════════════════════════════
     1. LAZY LOADING IMAGES WITH FADE-IN
     ════════════════════════════════════════════════════════ */
  function initLazyLoading() {
    const images = document.querySelectorAll('img[loading="lazy"]');
    
    if ('IntersectionObserver' in window) {
      const imageObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            const img = entry.target;
            img.addEventListener('load', () => {
              img.classList.add('loaded');
            });
            if (img.complete) {
              img.classList.add('loaded');
            }
            imageObserver.unobserve(img);
          }
        });
      }, { rootMargin: '50px' });
      
      images.forEach(img => imageObserver.observe(img));
    } else {
      images.forEach(img => img.classList.add('loaded'));
    }
  }

  /* ════════════════════════════════════════════════════════
     2. TOAST NOTIFICATIONS
     ════════════════════════════════════════════════════════ */
  let toastContainer = null;
  
  function initToastContainer() {
    if (toastContainer) return;
    
    toastContainer = document.createElement('div');
    toastContainer.className = 'toast-container';
    toastContainer.setAttribute('role', 'region');
    toastContainer.setAttribute('aria-label', 'Notifications');
    document.body.appendChild(toastContainer);
  }
  
  function showToast(title, message, type = 'info', duration = 3000) {
    initToastContainer();
    
    const icons = {
      success: 'fas fa-check-circle',
      error: 'fas fa-exclamation-circle',
      info: 'fas fa-info-circle',
      warning: 'fas fa-exclamation-triangle'
    };
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.setAttribute('role', 'alert');
    toast.innerHTML = `
      <i class="${icons[type]} toast-icon"></i>
      <div class="toast-content">
        <div class="toast-title">${title}</div>
        <div class="toast-message">${message}</div>
      </div>
    `;
    
    toastContainer.appendChild(toast);
    
    setTimeout(() => {
      toast.classList.add('toast-exit');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }
  
  window.showToast = showToast;

  /* ════════════════════════════════════════════════════════
     3. SKIP TO CONTENT LINK
     ════════════════════════════════════════════════════════ */
  function addSkipLink() {
    const skipLink = document.createElement('a');
    skipLink.href = '#main-content';
    skipLink.className = 'skip-to-content';
    skipLink.textContent = 'Skip to main content';
    document.body.insertBefore(skipLink, document.body.firstChild);
    
    const mainContent = document.querySelector('main, [role="main"]') || 
                       document.querySelector('section');
    if (mainContent && !mainContent.id) {
      mainContent.id = 'main-content';
    }
  }

  /* ════════════════════════════════════════════════════════
     4. ENHANCED IMAGE OPTIMIZATION
     ════════════════════════════════════════════════════════ */
  function optimizeImages() {
    const images = document.querySelectorAll('img:not([loading])');
    images.forEach(img => {
      const rect = img.getBoundingClientRect();
      const isInViewport = rect.top < window.innerHeight && rect.bottom > 0;
      
      if (!isInViewport) {
        img.setAttribute('loading', 'lazy');
      }
      
      if (!img.alt && img.src) {
        const filename = img.src.split('/').pop().split('.')[0];
        img.alt = filename.replace(/[-_]/g, ' ');
      }
    });
  }

  /* ════════════════════════════════════════════════════════
     5. PERFORMANCE MONITORING
     ════════════════════════════════════════════════════════ */
  function logPerformanceMetrics() {
    if ('performance' in window && 'PerformanceObserver' in window) {
      window.addEventListener('load', () => {
        setTimeout(() => {
          const perfData = performance.getEntriesByType('navigation')[0];
          if (perfData) {
            console.log('Performance Metrics:');
            console.log('  DOM Load: ' + Math.round(perfData.domContentLoadedEventEnd) + 'ms');
            console.log('  Full Load: ' + Math.round(perfData.loadEventEnd) + 'ms');
          }
        }, 0);
      });
    }
  }

  /* ════════════════════════════════════════════════════════
     6. KEYBOARD NAVIGATION ENHANCEMENT
     ════════════════════════════════════════════════════════ */
  function enhanceKeyboardNav() {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        document.body.classList.add('keyboard-nav');
      }
    });
    
    document.addEventListener('mousedown', () => {
      document.body.classList.remove('keyboard-nav');
    });
  }

  /* ════════════════════════════════════════════════════════
     7. STRUCTURED DATA VALIDATION
     ════════════════════════════════════════════════════════ */
  function validateStructuredData() {
    const scripts = document.querySelectorAll('script[type="application/ld+json"]');
    scripts.forEach(script => {
      try {
        JSON.parse(script.textContent);
      } catch (e) {
        console.error('Invalid structured data:', e);
      }
    });
  }

  /* ════════════════════════════════════════════════════════
     INITIALIZATION
     ════════════════════════════════════════════════════════ */
  function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
      return;
    }
    
    addSkipLink();
    initLazyLoading();
    optimizeImages();
    enhanceKeyboardNav();
    logPerformanceMetrics();
    validateStructuredData();
  }
  
  init();
  
})();
