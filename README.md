# AJournal - Automated Work Journal Generator

[![Node.js](https://img.shields.io/badge/node.js-18+-green.svg)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

AJournal is an intelligent work tracking system that automatically generates professional daily, weekly, monthly, and quarterly work journals by integrating with your existing tools and using AI to create meaningful summaries.

## Features

- **Multi-platform Integration**: Automatically syncs data from Slack, GitHub, Google Calendar, and JIRA
- **AI-Powered Summarization**: Uses Anthropic's Claude to create intelligent work summaries
- **Intelligent Organization**: Hierarchical folder structure with daily journals and collated reports (weekly, monthly, quarterly)
- **JIRA Integration**: Track ticket activities including creation, updates, and comments
- **Configurable Filtering**: Fine-tune what data to collect from each platform
- **Markdown Output**: Clean, readable journal entries that you can edit manually
- **Privacy-Focused**: All data stored locally on your machine
- **Flexible Scheduling**: On-demand sync or integrate with cron for automation

## Quick Start

### 1. Installation

```bash
git clone <your-repo-url>
cd ajournal
npm install
```

### 2. Setup API Keys

Copy the example environment file and fill in your API keys:

```bash
cp .env.example .env
```

Edit `.env` with your credentials:
- `ANTHROPIC_API_KEY`: Your Anthropic API key
- `SLACK_BOT_TOKEN`: Your Slack user token (xoxp-...)
- `GITHUB_TOKEN`: Your GitHub personal access token
- `GOOGLE_CREDENTIALS_PATH`: Path to your Google OAuth credentials JSON
- `JIRA_API_TOKEN`: Your JIRA API token (optional)

### 3. Configure Integrations

Copy and customize the example configuration:

```bash
cp config.example.json config.json
```

Edit `config.json` to customize:
- Which channels/repos/calendars/projects to include/exclude
- What types of activities to track
- AI summarization preferences
- Journal output format and folder structure

### 4. First Sync

```bash
# Migrate existing journals to new folder structure (if upgrading)
node src/cli.js migrate

# Sync data from all integrations for the last day
node src/cli.js sync

# Generate your first journal entry
node src/cli.js run
```

## Web UI

AJournal now includes a modern web interface for managing your journals, running syncs, and configuring integrations.

### Start the Web UI

```bash
# Start the web interface
npm run web

# Or use the CLI directly
node src/web-server.js
```

The web interface will be available at `http://localhost:3000` and includes:

- **📚 Journal Browser**: View, search, and edit all your journals in a clean interface
- **⚙️ Sync Controls**: Trigger syncs for specific integrations or date ranges
- **📊 Status Dashboard**: Monitor sync status and integration health
- **🛠️ Setup Wizard**: Configure API keys and integration settings
- **📝 Live Editing**: Edit journal entries with live preview

### Web UI Features

- **Responsive Design**: Works on desktop, tablet, and mobile devices
- **Real-time Updates**: Automatic refresh after sync and generation operations  
- **Search & Filter**: Find journals quickly with built-in search
- **Configuration Management**: Edit config.json directly from the web interface
- **Status Monitoring**: Visual indicators for all integration statuses
- **Markdown Support**: Rich text rendering for journal entries

## CLI Commands

### Sync Data
```bash
# Sync all integrations for the last day (default)
node src/cli.js sync

# Sync specific integration
node src/cli.js sync --integration slack

# Sync custom number of days
node src/cli.js sync --days 3
```

### Generate Journals & Reports
```bash
# Generate daily journal for today
node src/cli.js run

# Generate journal for specific date
node src/cli.js generate --date 2024-01-15

# Generate for last N days
node src/cli.js generate --range 7

# Generate weekly report
node src/cli.js weekly-report

# Generate monthly report
node src/cli.js monthly-report

# Generate quarterly report
node src/cli.js quarterly-report
```

### Configuration Management
```bash
# Show current configuration
node src/cli.js config --show

# Update configuration
node src/cli.js config --set "integrations.slack.enabled=false"

# Reset to defaults
node src/cli.js config --reset
```

### Status & Monitoring
```bash
# Check sync status and recent journals
node src/cli.js status

# Run initial setup wizard
node src/cli.js setup
```

### Migration & Setup
```bash
# Migrate existing journals to new folder structure
node src/cli.js migrate

# Show help and available commands
node src/cli.js --help
```

## API Setup Instructions

### Slack User Token
1. Go to [Slack API](https://api.slack.com/apps)
2. Create a new app for your workspace
3. Go to "OAuth & Permissions" and add these **User Token Scopes**:
   - `channels:read` - View basic information about public channels you're in
   - `channels:history` - View messages in public channels you're in
   - `groups:read` - View basic information about private channels you're in
   - `groups:history` - View messages in private channels you're in
   - `im:read` - View basic information about direct messages
   - `im:history` - View direct message history
   - `mpim:read` - View basic information about group direct messages
   - `mpim:history` - View group direct message history
   - `users:read` - View user information
4. Click "Install to Workspace" and authorize the app
5. Copy the "User OAuth Token" (starts with `xoxp-`) to your `.env` file

**Why User Token?** Automatically accesses all channels/DMs you're already in - no bot invitations needed!

### GitHub Personal Access Token
1. Go to GitHub Settings → Developer settings → Personal access tokens
2. Generate a new token with these scopes:
   - `repo` (for private repos) or `public_repo` (for public only)
   - `read:user`
3. Copy the token to your `.env` file

### Google Calendar API
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing
3. Enable the Google Calendar API:
   - Go to "APIs & Services" → "Library"
   - Search for "Google Calendar API" and enable it
4. Create OAuth 2.0 credentials:
   - Go to "APIs & Services" → "Credentials"
   - Click "Create Credentials" → "OAuth client ID"
   - Choose "Desktop application"
   - Download the credentials JSON file
5. Set `GOOGLE_CREDENTIALS_PATH` in your `.env` file to point to the JSON file
6. Run the OAuth setup script: `node setup-google-oauth.js`
7. Complete the authorization in your browser and paste the code

The setup script will save your token and test the connection automatically.

### JIRA API Token (Optional)
1. Go to [Atlassian Account Settings](https://id.atlassian.com/manage-profile/security/api-tokens)
2. Click "Create API token"
3. Give it a descriptive label (e.g., "AJournal Integration")
4. Copy the generated token to your `.env` file as `JIRA_API_TOKEN`
5. Update your `config.json` with:
   - `host`: Your JIRA instance URL (e.g., "company.atlassian.net")
   - `username`: Your email address used for JIRA
   - `enabled`: Set to `true` to activate JIRA integration

**What it tracks**: Ticket creation, updates, comments, and project activity for comprehensive work documentation.

## Configuration Options

### Integration Filters

**Slack:**
- `excludeChannels`: Array of channel names to skip
- `excludeChannelPatterns`: Patterns like "test-*" to exclude matching channels
- `minMessageLength`: Minimum message length to track
- `trackDMs`: Whether to include direct messages

**GitHub:**
- `excludeRepos`: Array of repository names to skip
- `excludeRepoPatterns`: Patterns to exclude matching repos
- `trackPRsCreated/Reviewed`: What PR activities to track
- `trackCommits/Issues`: Additional activity types

**Google Calendar:**
- `excludeCalendars`: Calendar names to skip
- `minDuration`: Minimum meeting length in minutes
- `trackAttendees`: Whether to include attendee information

**JIRA:**
- `excludeProjects`: Array of project keys to skip
- `excludeProjectPatterns`: Patterns to exclude matching projects
- `trackCreated/Updated/Commented`: What ticket activities to track
- `maxResults`: Limit results per query

### AI Configuration
- `summarizationPrompt`: Custom prompt for AI summarization
- `categorizeWork`: Enable automatic activity categorization
- `includeMetrics`: Add productivity metrics to summaries

### Journal Output
- `groupBy`: How to organize activities ("chronological", "by-tool", "by-project")
- `includeRawData`: Add raw data section for debugging
- `dateFormat/timeFormat`: Customize date/time display

## Journal Structure

### Daily Journals
Stored in `./data/journals/daily/YYYY/week-NN/` and include:

1. **AI Summary**: High-level overview of the day's activities
2. **Insights**: Productivity patterns and recommendations  
3. **Daily Metrics**: Activity counts and time allocation
4. **Calendar Events**: Meeting summaries with attendees and durations
5. **GitHub Activities**: PRs created/reviewed, commits, issues
6. **JIRA Activities**: Ticket creation, updates, and comments
7. **Slack Communications**: Message summaries by channel
8. **Manual Notes**: Space for your own additions

### Reports
Stored in `./data/journals/reports/` with weekly, monthly, and quarterly summaries:
- **Weekly**: Aggregated metrics and accomplishments for the week
- **Monthly**: Comprehensive overview of the month's progress
- **Quarterly**: High-level strategic review and patterns

## Privacy & Data

- All data stored locally in the `./data` directory
- Raw API responses saved for transparency and debugging
- No data sent to external services except for AI summarization
- Configure `.gitignore` to exclude sensitive data from version control

## Advanced Usage

### Automation with Cron
Add to your crontab for daily automation:
```bash
# Sync at 6 PM every weekday
0 18 * * 1-5 cd /path/to/ajournal && npm run sync

# Generate journal at 7 PM  
0 19 * * 1-5 cd /path/to/ajournal && npm run generate
```

### Custom AI Prompts
Modify the `summarizationPrompt` in your config to get different styles of summaries:

```json
{
  "ai": {
    "summarizationPrompt": "Create a brief, bullet-point summary focusing on accomplishments and blockers. Use casual language and include time estimates."
  }
}
```

### Historical Analysis
Use the reporting features to analyze productivity patterns:

```bash
# Generate comprehensive reports
node src/cli.js weekly-report
node src/cli.js monthly-report
node src/cli.js quarterly-report

# Sync historical data
node src/cli.js sync --days 30
node src/cli.js generate --date 2024-01-15
```

## Troubleshooting

### Common Issues

**"API key not found" errors:**
- Check your `.env` file exists and has correct keys
- Ensure no spaces around the `=` in env variables
- For JIRA, verify `JIRA_API_TOKEN` is set and `config.json` has correct host/username

**Google Calendar "Token not found":**
- OAuth2 setup required - see Google Calendar API section
- Service account credentials need proper calendar access

**Slack "channel not found" errors:**
- Ensure you're using a User token (xoxp-), not Bot token (xoxb-)
- Check OAuth scopes include required permissions

**GitHub rate limiting:**
- GitHub API has rate limits (60/hour for personal tokens)
- Use `--days 1` for daily syncing to stay within limits

**JIRA connection issues:**
- Verify your Atlassian instance URL is correct (without https://)
- Ensure your email matches the one used for JIRA login
- Check if your organization requires additional authentication

### Debug Mode
Set environment variable for verbose logging:
```bash
export DEBUG=ajournal:*
node src/cli.js sync
```

### File Structure
After setup, your project will have this structure:
```
ajournal/
├── data/
│   ├── journals/
│   │   ├── daily/
│   │   │   └── 2024/
│   │   │       └── week-03/
│   │   │           └── 2024-01-15.md
│   │   └── reports/
│   │       ├── weekly/
│   │       ├── monthly/
│   │       └── quarterly/
│   ├── raw-data/
│   └── sync-state.json
├── config.json (your settings)
├── .env (your API keys)
└── ...
```

## Contributing

This is a personal productivity tool, but contributions are welcome:

1. Fork the repository
2. Create a feature branch
3. Add tests for new functionality  
4. Submit a pull request

## License

MIT License - see LICENSE file for details.

---

*Generated with ❤️ for productive developers*