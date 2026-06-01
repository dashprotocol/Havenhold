import posthog from 'posthog-js';

export function initPostHog(): void {
  if (!import.meta.env.VITE_POSTHOG_KEY) return;
  posthog.init(import.meta.env.VITE_POSTHOG_KEY, {
    api_host: 'https://us.i.posthog.com',
    session_recording: {
      maskAllInputs: true,
      // Block <main> content AND all Radix UI portal containers.
      // Radix renders dialogs/sheets/alerts outside <main> via [data-radix-portal],
      // so both selectors are required to prevent health data from appearing in replays.
      blockSelector: '.ph-no-capture, [data-radix-portal]',
    },
    capture_pageview: true,
    capture_pageleave: true,
  });
}
