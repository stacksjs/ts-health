export default {
  title: 'ts-health',
  description: 'TypeScript library for health, fitness & smartwatch data. Oura Ring, WHOOP, Fitbit, Garmin, Polar, Suunto, Coros, Wahoo, Apple Health — with FIT parsing, training metrics, and more.',

  themeConfig: {
    nav: [
      { text: 'Home', link: '/' },
      { text: 'Guide', link: '/intro' },
      { text: 'Features', link: '/features/oura-ring' },
      { text: 'GitHub', link: 'https://github.com/stacksjs/ts-health' },
    ],

    sidebar: [
      {
        text: 'Getting Started',
        items: [
          { text: 'Introduction', link: '/intro' },
          { text: 'Installation', link: '/install' },
          { text: 'Usage Guide', link: '/usage' },
          { text: 'Configuration', link: '/config' },
        ],
      },
      {
        text: 'Features',
        items: [
          { text: 'Oura Ring', link: '/features/oura-ring' },
          { text: 'WHOOP', link: '/features/whoop' },
          { text: 'Apple Health', link: '/features/apple-health' },
          { text: 'Fitbit', link: '/features/fitbit' },
          { text: 'Garmin Devices', link: '/features/garmin' },
          { text: 'FIT File Parsing', link: '/features/fit-parsing' },
          { text: 'Training Metrics', link: '/features/training-metrics' },
          { text: 'Data Export', link: '/features/data-export' },
          { text: 'Sleep Tracking', link: '/features/sleep-tracking' },
          { text: 'Training Readiness', link: '/features/training-readiness' },
          { text: 'Recovery Analysis', link: '/features/recovery-analysis' },
          { text: 'Health Trends', link: '/features/health-trends' },
        ],
      },
      {
        text: 'Advanced',
        items: [
          { text: 'CLI Reference', link: '/advanced/cli-reference' },
          { text: 'Sleep Debt Analysis', link: '/advanced/sleep-debt' },
          { text: 'Anomaly Detection', link: '/advanced/anomaly-detection' },
          { text: 'Multi-Platform', link: '/advanced/multi-platform' },
          { text: 'Real-time Sensors', link: '/advanced/realtime-sensors' },
          { text: 'Cloud Integrations', link: '/advanced/cloud-integrations' },
          { text: 'Custom Drivers', link: '/advanced/custom-drivers' },
        ],
      },
      {
        text: 'Community',
        items: [
          { text: 'Team', link: '/team' },
          { text: 'Showcase', link: '/showcase' },
          { text: 'Sponsors', link: '/sponsors' },
          { text: 'Partners', link: '/partners' },
          { text: 'Stargazers', link: '/stargazers' },
          { text: 'Postcardware', link: '/postcardware' },
          { text: 'License', link: '/license' },
        ],
      },
    ],

    socialLinks: [
      { icon: 'github', link: 'https://github.com/stacksjs/ts-health' },
      { icon: 'discord', link: 'https://discord.gg/stacksjs' },
      { icon: 'twitter', link: 'https://twitter.com/stacksjs' },
    ],

    footer: {
      message: 'Released under the MIT License.',
      copyright: 'Copyright © 2025-present Stacks.js',
    },

    search: {
      enabled: true,
      placeholder: 'Search documentation...',
    },
  },

  markdown: {
    toc: {
      enabled: true,
      minDepth: 2,
      maxDepth: 4,
    },

    features: {
      containers: true,
      githubAlerts: true,
      codeGroups: true,
      emoji: true,
      badges: true,
    },
  },

  sitemap: {
    enabled: true,
    baseUrl: 'https://ts-health.netlify.app',
  },
}
