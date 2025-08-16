import { Octokit } from '@octokit/rest';
import { format, startOfDay, endOfDay } from 'date-fns';

class GitHubIntegration {
  constructor(config, storage) {
    this.name = 'GitHub';
    this.config = config.integrations.github;
    this.storage = storage;
    this.octokit = new Octokit({
      auth: process.env.GITHUB_TOKEN,
    });
    this.username = null;
  }

  async sync(startDate, endDate) {
    try {
      // Get authenticated user info
      if (!this.username) {
        const { data: user } = await this.octokit.rest.users.getAuthenticated();
        this.username = user.login;
      }

      const activities = [];

      // Get PRs created
      if (this.config.trackPRsCreated) {
        const createdPRs = await this.getPRsCreated(startDate, endDate);
        activities.push(...createdPRs);
      }

      // Get PRs reviewed
      if (this.config.trackPRsReviewed) {
        const reviewedPRs = await this.getPRsReviewed(startDate, endDate);
        activities.push(...reviewedPRs);
      }

      // Get issues worked on
      if (this.config.trackIssues) {
        const issues = await this.getIssuesWorkedOn(startDate, endDate);
        activities.push(...issues);
      }

      // Get commits
      if (this.config.trackCommits) {
        const commits = await this.getCommits(startDate, endDate);
        activities.push(...commits);
      }

      // Filter out excluded repositories
      const filteredActivities = this.filterRepositories(activities);

      // Group activities by date and save
      const activitiesByDate = this.groupActivitiesByDate(filteredActivities);
      
      for (const [dateStr, dayActivities] of Object.entries(activitiesByDate)) {
        await this.storage.saveRawData('github', dateStr, dayActivities);
      }

      // Update sync state
      await this.storage.setSyncState('github', {
        lastSyncStart: startDate.toISOString(),
        lastSyncEnd: endDate.toISOString(),
        totalActivities: filteredActivities.length,
        username: this.username,
      });

      return filteredActivities;
    } catch (error) {
      console.error('GitHub sync error:', error.message);
      throw error;
    }
  }

  async getPRsCreated(startDate, endDate) {
    try {
      const prs = [];
      const formattedStart = startDate.toISOString().split('T')[0];
      const formattedEnd = endDate.toISOString().split('T')[0];
      
      // Search for PRs created by the user in the date range
      const { data } = await this.octokit.rest.search.issuesAndPullRequests({
        q: `author:${this.username} type:pr created:${formattedStart}..${formattedEnd}`,
        sort: 'created',
        order: 'desc',
        per_page: 100,
      });

      for (const pr of data.items) {
        prs.push({
          type: 'pr_created',
          repository: pr.repository_url.split('/').slice(-2).join('/'),
          title: pr.title,
          number: pr.number,
          url: pr.html_url,
          timestamp: pr.created_at,
          state: pr.state,
          draft: pr.draft,
          labels: pr.labels.map(l => l.name),
          additions: 0, // Will be filled in detailed call if needed
          deletions: 0,
          changedFiles: 0,
        });
      }

      return prs;
    } catch (error) {
      console.error('Error fetching created PRs:', error.message);
      return [];
    }
  }

  async getPRsReviewed(startDate, endDate) {
    try {
      const reviews = [];
      
      // GitHub doesn't have a direct search for reviews, so we'll search for PRs where user has commented
      // This is a limitation we'll document
      const formattedStart = startDate.toISOString().split('T')[0];
      const formattedEnd = endDate.toISOString().split('T')[0];
      
      const { data } = await this.octokit.rest.search.issuesAndPullRequests({
        q: `commenter:${this.username} type:pr updated:${formattedStart}..${formattedEnd}`,
        sort: 'updated',
        order: 'desc',
        per_page: 100,
      });

      for (const pr of data.items) {
        // Skip PRs created by the same user
        if (pr.user.login === this.username) continue;

        // Check if there are actual reviews (this requires additional API calls)
        try {
          const [owner, repo] = pr.repository_url.split('/').slice(-2);
          const { data: prReviews } = await this.octokit.rest.pulls.listReviews({
            owner,
            repo,
            pull_number: pr.number,
          });

          const userReviews = prReviews.filter(review => 
            review.user.login === this.username &&
            new Date(review.submitted_at) >= startDate &&
            new Date(review.submitted_at) <= endDate
          );

          for (const review of userReviews) {
            reviews.push({
              type: 'pr_reviewed',
              repository: `${owner}/${repo}`,
              title: pr.title,
              number: pr.number,
              url: pr.html_url,
              timestamp: review.submitted_at,
              reviewState: review.state,
              reviewBody: review.body,
              author: pr.user.login,
            });
          }
        } catch (reviewError) {
          console.error(`Error fetching reviews for PR ${pr.number}:`, reviewError.message);
        }
      }

      return reviews;
    } catch (error) {
      console.error('Error fetching reviewed PRs:', error.message);
      return [];
    }
  }

  async getIssuesWorkedOn(startDate, endDate) {
    try {
      const issues = [];
      const formattedStart = startDate.toISOString().split('T')[0];
      const formattedEnd = endDate.toISOString().split('T')[0];
      
      // Search for issues where user has commented or been assigned
      const { data } = await this.octokit.rest.search.issuesAndPullRequests({
        q: `involves:${this.username} type:issue updated:${formattedStart}..${formattedEnd}`,
        sort: 'updated',
        order: 'desc',
        per_page: 100,
      });

      for (const issue of data.items) {
        issues.push({
          type: 'issue_activity',
          repository: issue.repository_url.split('/').slice(-2).join('/'),
          title: issue.title,
          number: issue.number,
          url: issue.html_url,
          timestamp: issue.updated_at,
          state: issue.state,
          labels: issue.labels.map(l => l.name),
          assignees: issue.assignees.map(a => a.login),
          isAssigned: issue.assignees.some(a => a.login === this.username),
        });
      }

      return issues;
    } catch (error) {
      console.error('Error fetching issues:', error.message);
      return [];
    }
  }

  async getCommits(startDate, endDate) {
    try {
      const commits = [];
      const formattedStart = startDate.toISOString();
      const formattedEnd = endDate.toISOString();
      
      // This is complex as we need to search across all repos the user has access to
      // For now, we'll get user's repositories and check commits in each
      const { data: repos } = await this.octokit.rest.repos.listForAuthenticatedUser({
        type: 'all',
        sort: 'updated',
        per_page: 100,
      });

      for (const repo of repos.slice(0, 20)) { // Limit to avoid rate limits
        try {
          const { data: repoCommits } = await this.octokit.rest.repos.listCommits({
            owner: repo.owner.login,
            repo: repo.name,
            author: this.username,
            since: formattedStart,
            until: formattedEnd,
            per_page: 100,
          });

          for (const commit of repoCommits) {
            commits.push({
              type: 'commit',
              repository: repo.full_name,
              sha: commit.sha,
              message: commit.commit.message,
              url: commit.html_url,
              timestamp: commit.commit.author.date,
              additions: commit.stats?.additions || 0,
              deletions: commit.stats?.deletions || 0,
              totalChanges: commit.stats?.total || 0,
            });
          }
        } catch (commitError) {
          // Skip repositories we can't access
          if (commitError.status !== 409 && commitError.status !== 404) {
            console.error(`Error fetching commits from ${repo.full_name}:`, commitError.message);
          }
        }
      }

      return commits;
    } catch (error) {
      console.error('Error fetching commits:', error.message);
      return [];
    }
  }

  filterRepositories(activities) {
    return activities.filter(activity => {
      const repoName = activity.repository;
      
      // Skip excluded repositories
      if (this.config.excludeRepos.includes(repoName)) {
        return false;
      }

      // Skip repositories matching excluded patterns
      if (this.config.excludeRepoPatterns.some(pattern => {
        const regex = new RegExp(pattern.replace('*', '.*'), 'i');
        return regex.test(repoName);
      })) {
        return false;
      }

      return true;
    });
  }

  groupActivitiesByDate(activities) {
    const grouped = {};
    
    for (const activity of activities) {
      const date = format(new Date(activity.timestamp), 'yyyy-MM-dd');
      if (!grouped[date]) {
        grouped[date] = [];
      }
      grouped[date].push(activity);
    }
    
    return grouped;
  }
}

export default GitHubIntegration;