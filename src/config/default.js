export const defaultConfig = {
  integrations: {
    slack: {
      username: null, // Slack username to track (set during setup)
      userId: null, // Slack user ID to track (set during setup)
      enabled: true,
      excludeChannels: ['random', 'general'],
      excludeChannelPatterns: ['test-*', 'temp-*'],
      trackDMs: true,
      trackReactions: true,
      trackThreads: true,
      minMessageLength: 10,
      maxConversations: 25, // Reasonable for internal apps with Tier 3 limits
      maxMessages: 200, // Max messages to retrieve from search API
      rateLimitDelay: 1200, // ~50 requests/minute (Tier 3 limits)
    },
    github: {
      username: null, // GitHub username to track (set during setup)
      enabled: true,
      excludeRepos: [],
      excludeRepoPatterns: ['*-playground', '*-test'],
      trackPRsCreated: true,
      trackPRsReviewed: true,
      trackIssues: false,
      trackCommits: false,
    },
    gcal: {
      enabled: true,
      includeCalendars: [], // Specific calendars to track (leave empty to track all)
      excludeCalendars: ['personal', 'Birthdays', 'holidays'],
      excludeCalendarPatterns: ['*personal*', '*birthday*', '*holiday*'],
      minDuration: 15,
      trackAttendees: true,
      trackLocation: false,
    },
    jira: {
      enabled: false, // Set to true and configure below to enable JIRA integration
      protocol: 'https',
      host: 'your-company.atlassian.net', // Your JIRA instance URL
      username: 'your-email@company.com', // Your JIRA username/email
      reportUserName: 'your-member@company.com', // Your JIRA username/email
      apiToken: process.env.JIRA_API_TOKEN, // API token from env
      apiVersion: '2',
      strictSSL: true,
      trackCreated: true,
      trackUpdated: true,
      trackCommented: true,
      excludeProjects: [], // Projects to exclude
      excludeProjectPatterns: ['TEST-*', 'TEMP-*'],
      includeProjects: [], // Specific projects to track (leave empty for all)
      maxResults: 100, // Max tickets per search
    },
  },
  ai: {
    provider: 'anthropic',
    model: 'claude-3-sonnet-20240229',
    summarizationPrompt: `Analyze the following work activities and create a concise, professional summary for a work journal. Focus on:
- Key accomplishments and progress made
- Important communications and decisions
- Time allocation across different activities
- Notable insights or blockers encountered

Format as bullet points under relevant categories. Keep it factual and actionable.`,
    categorizeWork: true,
    includeMetrics: true,
    maxTokens: 2000,
  },
  journal: {
    format: 'markdown',
    outputDir: './data/journals',
    groupBy: 'chronological', // chronological, by-tool, by-project
    includeMetrics: true,
    includeRawData: false,
    dateFormat: 'yyyy-MM-dd',
    timeFormat: 'HH:mm',
  },
  sync: {
    lookbackDays: 1,
    maxRetries: 3,
    retryDelay: 1000,
    rateLimit: {
      slack: 50, // requests per minute
      github: 60,
      gcal: 100,
      jira: 200, // JIRA Cloud allows higher limits
    },
  },
  storage: {
    dataDir: './data',
    syncStateFile: './data/sync-state.json',
    rawDataDir: './data/raw-data',
  },
};