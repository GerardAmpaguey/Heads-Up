// Labels and settings shared by the page. All alerts and news come from /api/alerts.

export const CATEGORIES = {
  hazard: { label: 'Around you', blurb: 'Storms, quakes, floods, outages and local news for wherever you are.' },
  webdev: { label: 'Web dev', blurb: 'Releases, security fixes and changes for the tools you build with.' },
  ai: { label: 'AI & tech', blurb: 'AI models and tools, security news and the tech stories worth knowing about.' },
  planet: { label: 'Planet', blurb: 'Environment, climate, health outbreaks and how to stay safe.' },
};

export const SEVERITY = {
  urgent: { label: 'Urgent', rank: 0 },
  'heads-up': { label: 'Heads up', rank: 1 },
  fyi: { label: 'FYI', rank: 2 },
};

