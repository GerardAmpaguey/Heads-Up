// Demo content. Every item here is invented to show the layout; none of it is real news.
// Shape of an item (live feeds will produce the same shape later):
//   id, category ('hazard' | 'webdev' | 'ai'), severity ('urgent' | 'heads-up' | 'fyi'),
//   title, summary, action (what to do), source, url, ago (minutes), tags (for the watchlist)

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

export const ITEMS = [
  // Around you
  {
    id: 'h1', category: 'hazard', severity: 'urgent', ago: 95,
    title: 'Typhoon expected to reach northern Luzon within 48 hours',
    summary: 'A strengthening tropical cyclone is forecast to make landfall late this week, with heavy rain and strong winds.',
    action: 'Charge phones and power banks, store drinking water, back up work files and check the official advisories for your area.',
    source: 'GDACS', url: 'https://www.gdacs.org', tags: [],
  },
  {
    id: 'h2', category: 'hazard', severity: 'heads-up', ago: 260,
    title: 'Strong earthquake felt in the region, aftershocks possible',
    summary: 'A magnitude 6-class quake was recorded offshore. Minor damage is possible near the coast.',
    action: 'Know your exits, keep a bag ready, and avoid damaged buildings until they are checked.',
    source: 'USGS', url: 'https://earthquake.usgs.gov', tags: [],
  },
  {
    id: 'h3', category: 'hazard', severity: 'heads-up', ago: 1440,
    title: 'El Niño outlook: drier months ahead for the Philippines',
    summary: 'The seasonal outlook points to below-normal rainfall and higher temperatures in the coming months.',
    action: 'Plan for water and power use, and expect hotter working conditions at home.',
    source: 'NOAA', url: 'https://www.cpc.ncep.noaa.gov/products/analysis_monitoring/enso_advisory/', tags: [],
  },
  {
    id: 'h4', category: 'hazard', severity: 'heads-up', ago: 520,
    title: 'Internet disruption: undersea cable fault slows connections',
    summary: 'Providers report slower speeds and some drops while a damaged cable is repaired.',
    action: 'Save work offline, share a mobile hotspot as backup, and warn clients about possible delays.',
    source: 'ISP status', url: 'https://www.cloudflarestatus.com', tags: [],
  },
  {
    id: 'h5', category: 'hazard', severity: 'fyi', ago: 2100,
    title: 'Dengue cases rising in several provinces',
    summary: 'Health officials are reporting a seasonal rise in cases and asking households to clear standing water.',
    action: 'Remove standing water around the house and use repellent in the evenings.',
    source: 'Dept. of Health', url: 'https://doh.gov.ph', tags: [],
  },

  // Web dev
  {
    id: 'w1', category: 'webdev', severity: 'urgent', ago: 40,
    title: 'Critical plugin vulnerability is being attacked right now',
    summary: 'A widely used WordPress plugin has a flaw that lets attackers take over sites. Exploits are already circulating.',
    action: 'Check which of your client sites run it, update to the fixed version today, and scan for unfamiliar admin users.',
    source: 'Patchstack', url: 'https://patchstack.com', tags: ['WordPress'],
  },
  {
    id: 'w2', category: 'webdev', severity: 'heads-up', ago: 300,
    title: 'WordPress security release is out, auto-updates rolling out',
    summary: 'A minor core release fixes several security issues. Sites with auto-updates on will get it first.',
    action: 'Update staging first, check forms and checkout, then update live sites.',
    source: 'WordPress News', url: 'https://wordpress.org/news/', tags: ['WordPress'],
  },
  {
    id: 'w3', category: 'webdev', severity: 'heads-up', ago: 880,
    title: 'PHP version reaches end of life soon',
    summary: 'A PHP branch many hosts still run stops getting security fixes in a few months.',
    action: 'List the sites on that version and plan upgrades with your hosts before the date.',
    source: 'endoflife.date', url: 'https://endoflife.date/php', tags: ['PHP', 'WordPress'],
  },
  {
    id: 'w4', category: 'webdev', severity: 'fyi', ago: 600,
    title: 'Astro ships a new release with build speed improvements',
    summary: 'The latest release adds faster builds and a few new content features. No breaking changes for most sites.',
    action: 'Read the changelog and try it on a side project before updating client work.',
    source: 'Astro blog', url: 'https://astro.build/blog/', tags: ['Astro'],
  },
  {
    id: 'w5', category: 'webdev', severity: 'heads-up', ago: 1200,
    title: 'Next.js patch fixes a security issue in server features',
    summary: 'A patch release addresses a vulnerability that affects some self-hosted setups.',
    action: 'Update to the patched version and redeploy.',
    source: 'GitHub releases', url: 'https://github.com/vercel/next.js/releases', tags: ['Next.js'],
  },
  {
    id: 'w6', category: 'webdev', severity: 'fyi', ago: 1700,
    title: 'Cloudflare adds new Workers features to the changelog',
    summary: 'New options for static assets and scheduled jobs landed this week.',
    action: 'Skim the changelog for anything that simplifies your current projects.',
    source: 'Cloudflare changelog', url: 'https://developers.cloudflare.com/changelog/', tags: ['Cloudflare'],
  },
  {
    id: 'w7', category: 'webdev', severity: 'fyi', ago: 2600,
    title: 'Figma announces new dev handoff tools',
    summary: 'A set of updates aims to make it easier to move from design to code.',
    action: 'Check whether the new inspect features save time in your workflow.',
    source: 'Figma blog', url: 'https://www.figma.com/blog/', tags: ['Figma'],
  },
  {
    id: 'w8', category: 'webdev', severity: 'fyi', ago: 3000,
    title: 'Elementor release changes how some widgets load',
    summary: 'The update adjusts loading behaviour, which can affect page speed and a few custom layouts.',
    action: 'Test key pages on a staging copy before updating live sites.',
    source: 'Elementor blog', url: 'https://elementor.com/blog/', tags: ['Elementor', 'WordPress'],
  },
  {
    id: 'w9', category: 'webdev', severity: 'fyi', ago: 3400,
    title: 'Tailwind CSS publishes a new minor version',
    summary: 'Adds a few utilities and fixes. Existing projects keep working.',
    action: 'Update when convenient and rebuild.',
    source: 'Tailwind blog', url: 'https://tailwindcss.com/blog', tags: ['Tailwind'],
  },

  // AI
  {
    id: 'a1', category: 'ai', severity: 'heads-up', ago: 180,
    title: 'New AI model released with a much longer context window',
    summary: 'A major lab released a model that can read far longer documents in one go, with updated pricing.',
    action: 'Try it on a long document you work with and compare cost against what you use now.',
    source: 'Lab blog', url: 'https://www.anthropic.com/news', tags: [],
  },
  {
    id: 'a2', category: 'ai', severity: 'fyi', ago: 700,
    title: 'Coding assistants add support for team-wide rules files',
    summary: 'Several tools now let a project define shared instructions that every developer gets automatically.',
    action: 'Add a short rules file to your next repo so suggestions match how you build.',
    source: 'Dev tools news', url: 'https://news.ycombinator.com', tags: [],
  },
  {
    id: 'a3', category: 'ai', severity: 'fyi', ago: 1500,
    title: 'Report: how developers are using AI at work',
    summary: 'A new survey looks at which tasks developers hand to AI and where they still do the work themselves.',
    action: 'Skim the findings for ideas on where AI could save you time.',
    source: 'Research report', url: 'https://arxiv.org', tags: [],
  },
  {
    id: 'a4', category: 'ai', severity: 'heads-up', ago: 2200,
    title: 'Image tools tighten rules on AI-generated content labels',
    summary: 'Platforms are asking creators to label AI-generated images and video more clearly.',
    action: 'Check the rules before using generated images in client work.',
    source: 'Platform policy', url: 'https://news.ycombinator.com', tags: [],
  },
];
