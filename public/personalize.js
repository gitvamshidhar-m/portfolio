(function () {
  try {
    var p = new URLSearchParams(location.search);
    var utm = (p.get('utm_source') || '').toLowerCase();
    var cam = (p.get('utm_campaign') || '').toLowerCase();
    var ref = document.referrer || '';
    var refHost = '';
    try { refHost = new URL(ref).hostname.replace(/^www\./, ''); } catch (e) {}
    var r = document.getElementById('prz');
    var tag = '', link = null, msg = '', step = 'none';
    if (utm === 'linkedin' || /linkedin\.com/.test(ref)) { step = 'linkedin'; tag = 'LinkedIn'; msg = 'Seeing me from LinkedIn — recruiters usually jump straight to the proof.'; link = '/projects.html#proof'; }
    else if (utm === 'ads' || /ads|ppc/.test(cam)) { step = 'ads'; tag = 'Paid Media'; msg = 'You should see what the ad spend buys: paste a creative, get a predicted CTR — live product.'; link = '/projects.html#creative'; }
    else if (utm === 'seo' || /google\.|bing\.|duckduckgo/.test(ref)) { step = 'seo'; tag = 'Organic Search'; msg = 'Caught from search — here is the SEO case history that shows how my own site ranks.'; link = '/blog.html'; }
    else if (utm === 'ai' || /ai/.test(cam)) { step = 'ai'; tag = 'AI Automation'; msg = 'Interested in the AI side — three products I built solo prove the build half.'; link = '/projects.html#ai'; }
    else if (ref && refHost) { step = 'ref'; tag = refHost; msg = 'You got here from ' + refHost + ' — the fastest proof is the ROI calculator.'; link = '/contact.html'; }
    if (step !== 'none' && r) {
      r.hidden = false;
      r.innerHTML = '<span class="prz-tag"></span><a class="prz-link"></a><button class="prz-x" aria-label="Dismiss">×</button>';
      r.querySelector('.prz-tag').textContent = tag;
      var l = r.querySelector('.prz-link');
      if (link) { l.href = link; l.textContent = msg + ' →'; }
      else { l.textContent = msg; l.href = '#'; l.onclick = function () { return false; }; }
      r.querySelector('.prz-x').addEventListener('click', function () { r.hidden = true; });
    }
  } catch (e) {}
  try {
    console.log('%c👋 nice — you found the console.', 'color:#2ff3c0;font-weight:bold;font-size:14px');
    console.log('%cI build the tools I market. Ping me on LinkedIn /in/vamshidharreddym or email geovamshidhar@gmail.com.', 'color:#8b7bff;font-size:12px');
  } catch (e) {}
}());