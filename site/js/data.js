// Labels and settings shared by the page. All alerts and news come from /api/alerts.

export const CATEGORIES = {
  hazard: { label: 'Around you', blurb: 'Weather, quakes, outages and other things that could affect you.' },
  webdev: { label: 'Web dev', blurb: 'Releases, security fixes and changes for the tools you build with.' },
  ai: { label: 'AI', blurb: 'New tools, models and reports worth knowing about.' },
};

export const SEVERITY = {
  urgent: { label: 'Urgent', rank: 0 },
  'heads-up': { label: 'Heads up', rank: 1 },
  fyi: { label: 'FYI', rank: 2 },
};

export const STACK = ['WordPress', 'Elementor', 'Astro', 'Next.js', 'Tailwind', 'Cloudflare', 'PHP', 'Figma'];
