/*!
 * LearnDiag — Pro Click Tracking (site-wide snippet)
 * ============================================================================
 * WHAT IT DOES
 *   Listens for clicks on any element marked with [data-pro-click] and fires
 *   a `pro_click` event. Dual-compatible: pushes to window.dataLayer (GTM)
 *   and calls window.gtag('event', ...) when gtag is present. Always logs to
 *   console in debug mode.
 *
 * INSTALL
 *   Option A (direct): paste this file's contents before </body> inside a
 *     <script> tag, or serve it and add:
 *       <script src="/js/pro-click-tracking.js" defer></script>
 *   Option B (GTM): create a Custom HTML tag with this code, trigger on
 *     All Pages.
 *
 * MARKUP CONTRACT
 *   1. Mark every Pro / upgrade / pricing / waitlist CTA with:
 *        <a href="/pro" data-pro-click data-pro-click-source="nav_upgrade">…</a>
 *      - data-pro-click            (required) marks the element as a Pro CTA
 *      - data-pro-click-source     (recommended) human-readable slot name,
 *                                  e.g. "results_banner", "nav_upgrade",
 *                                  "study_plan_upsell". Falls back to tag name.
 *   2. Put test context on the nearest results container (or any ancestor of
 *      the CTA) so the event picks it up automatically:
 *        <div id="results" data-test-code="5001" data-score-band="50-69">
 *      - data-test-code   → event param test_code  (null if absent)
 *      - data-score-band  → event param score_band (null if absent)
 *      Lookup order: closest ancestor of the clicked element first, then the
 *      first element on the page carrying these attributes, else null.
 *
 * EVENT
 *   pro_click {
 *     page:         string  // location.pathname, automatic
 *     test_code:    string|null   // e.g. "5001", "8002" … (see TRACKING-SPEC)
 *     score_band:   string|null   // "0-49" | "50-69" | "70-100"
 *     click_target: string        // slot identifier for the CTA
 *   }
 *
 * DEBUG
 *   Set window.LD_PRO_TRACK_DEBUG = true before this script runs to enable
 *   console logging (default: true for now; flip to false in production if
 *   console noise is a concern).
 * ============================================================================
 */
(function () {
  'use strict';

  var DEBUG = typeof window.LD_PRO_TRACK_DEBUG === 'boolean'
    ? window.LD_PRO_TRACK_DEBUG
    : false;

  function track(eventName, params) {
    window.dataLayer = window.dataLayer || [];
    window.dataLayer.push(Object.assign({ event: eventName }, params));
    if (typeof window.gtag === 'function') {
      window.gtag('event', eventName, params);
    }
    if (DEBUG && window.console && console.log) {
      console.log('[LearnDiag track]', eventName, params);
    }
  }

  /** Walk up from el to find the nearest data-test-code / data-score-band. */
  function contextFrom(el) {
    var node = el;
    while (node && node !== document.documentElement) {
      if (node.dataset && (node.dataset.testCode || node.dataset.scoreBand)) {
        return {
          test_code: node.dataset.testCode || null,
          score_band: node.dataset.scoreBand || null
        };
      }
      node = node.parentElement;
    }
    var pageLevel = document.querySelector('[data-test-code], [data-score-band]');
    return {
      test_code: pageLevel ? (pageLevel.dataset.testCode || null) : null,
      score_band: pageLevel ? (pageLevel.dataset.scoreBand || null) : null
    };
  }

  /* Delegated listener: works for dynamically injected CTAs too. */
  document.addEventListener('click', function (e) {
    var trigger = e.target && e.target.closest
      ? e.target.closest('[data-pro-click]')
      : null;
    if (!trigger) return;

    var ctx = contextFrom(trigger);
    track('pro_click', {
      page: location.pathname,
      test_code: ctx.test_code,
      score_band: ctx.score_band,
      click_target: trigger.dataset.proClickSource || trigger.tagName.toLowerCase()
    });
  }, true /* capture: fire even if other handlers stopPropagation */);
})();
