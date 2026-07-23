import JiraClient from 'node-jira-client';
import { format, addDays } from 'date-fns';

class JiraIntegration {
  constructor(config, storage) {
    this.config = config.integrations.jira;
    this.storage = storage;
    this.name = 'JIRA';
    
    if (this.config.enabled) {
      this.client = new JiraClient({
        protocol: this.config.protocol || 'https',
        host: this.config.host,
        username: this.config.username,
        password: this.config.apiToken,
        apiVersion: this.config.apiVersion || '2',
        strictSSL: this.config.strictSSL !== false,
        reportUserName: this.config.reportUserName || this.config.username
      });
    }
  }

  async sync(startDate, endDate) {
    if (!this.config.enabled) {
      console.log('JIRA integration disabled');
      return;
    }

    try {
      console.log(`🎫 Syncing JIRA tickets for ${this.config.reportUserName}...`);

      // Jira Cloud no longer exposes author.name (GDPR); resolve our accountId once.
      // Also grab displayName — email strings don't resolve in JQL on this instance.
      if (this.accountId === undefined) {
        try {
          const me = await this.client.getCurrentUser();
          this.accountId = me.accountId || null;
          this.displayName = me.displayName || null;
        } catch (error) {
          console.warn('⚠️ Could not resolve JIRA accountId:', error.message);
          this.accountId = null;
          this.displayName = null;
        }
      }

      // Get current date and process day by day
      let currentDate = new Date(startDate);
      const end = new Date(endDate);
      let totalActivities = 0;

      while (currentDate <= end) {
        const activities = await this.getActivitiesForDate(currentDate);
        
        if (activities.length > 0) {
          await this.storage.saveRawData('jira', currentDate, activities);
          console.log(`✅ ${activities.length} activities for ${format(currentDate, 'yyyy-MM-dd')}`);
          totalActivities += activities.length;
        }
        
        currentDate = new Date(currentDate);
        currentDate.setDate(currentDate.getDate() + 1);
      }

      console.log(`📊 Total JIRA activities found: ${totalActivities}`);
      
      // Update sync state
      await this.storage.setSyncState('jira', {
        lastSyncDate: endDate.toISOString(),
        totalActivities
      });

      console.log('✅ JIRA sync completed successfully!');
    } catch (error) {
      console.error('JIRA sync error:', error.message);
      throw error;
    }
  }

  async getActivitiesForDate(date) {
    const activities = [];
    const dateStr = format(date, 'yyyy-MM-dd');
    
    try {
      // Get tickets created by user on this date
      const createdTickets = await this.searchTickets(
        `reporter = currentUser() AND created >= "${dateStr}" AND created < "${format(addDays(new Date(date), 1), 'yyyy-MM-dd')}"`
      );
      for (const ticket of createdTickets) {
        activities.push({
          timestamp: ticket.fields.created,
          type: 'ticket_created',
          ticketKey: ticket.key,
          summary: ticket.fields.summary,
          status: ticket.fields.status.name,
          priority: ticket.fields.priority?.name || 'None',
          assignee: ticket.fields.assignee?.displayName || 'Unassigned',
          reporter: ticket.fields.reporter.displayName,
          project: ticket.fields.project.name,
          issueType: ticket.fields.issuetype.name,
          url: `${this.config.protocol}://${this.config.host}/browse/${ticket.key}`,
          description: ticket.fields.description ? ticket.fields.description.substring(0, 200) : ''
        });
      }
      console.log(`Found ${createdTickets.length} tickets created on ${dateStr}`);

      // Get tickets assigned to user and updated on this date
      const updatedTickets = await this.searchTickets(
        `assignee = currentUser() AND updated >= "${dateStr}" AND updated < "${format(addDays(new Date(date), 1), 'yyyy-MM-dd')}"`
      );

      for (const ticket of updatedTickets) {
        // Get the change history for this ticket
        const changelog = await this.getTicketChangelog(ticket.key, date);
        
        if (changelog.length > 0) {
          for (const change of changelog) {
            activities.push({
              timestamp: change.created,
              type: 'ticket_updated',
              ticketKey: ticket.key,
              summary: ticket.fields.summary,
              status: ticket.fields.status.name,
              priority: ticket.fields.priority?.name || 'None',
              assignee: ticket.fields.assignee?.displayName || 'Unassigned',
              reporter: ticket.fields.reporter.displayName,
              project: ticket.fields.project.name,
              issueType: ticket.fields.issuetype.name,
              url: `${this.config.protocol}://${this.config.host}/browse/${ticket.key}`,
              changes: change.items.map(item => ({
                field: item.field,
                from: item.fromString,
                to: item.toString
              }))
            });
          }
        }
      }
      console.log(`Found ${updatedTickets.length} tickets updated on ${dateStr}`);

      // Get tickets where user was mentioned or commented
      const commentedTickets = await this.searchTickets(
        `(comment ~ "${this.displayName || this.config.reportUserName}" OR assignee = currentUser() OR reporter = currentUser()) AND updated >= "${dateStr}" AND updated < "${format(addDays(new Date(date), 1), 'yyyy-MM-dd')}"`
      );
      
      for (const ticket of commentedTickets) {
        const comments = await this.getTicketComments(ticket.key, date);
        
        for (const comment of comments) {
          if (this.isCommentByReportUser(comment)) {
            activities.push({
              timestamp: comment.created,
              type: 'comment_added',
              ticketKey: ticket.key,
              summary: ticket.fields.summary,
              status: ticket.fields.status.name,
              priority: ticket.fields.priority?.name || 'None',
              assignee: ticket.fields.assignee?.displayName || 'Unassigned',
              reporter: ticket.fields.reporter.displayName,
              project: ticket.fields.project.name,
              issueType: ticket.fields.issuetype.name,
              url: `${this.config.protocol}://${this.config.host}/browse/${ticket.key}`,
              comment: comment.body ? comment.body.substring(0, 200) : ''
            });
          }
        }
      }

    } catch (error) {
      console.error(`Error getting JIRA activities for ${dateStr}:`, error.message);
    }

    // Sort activities by timestamp
    activities.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
    return activities;
  }

  isCommentByReportUser(comment) {
    const author = comment.author || {};
    if (this.accountId && author.accountId) {
      return author.accountId === this.accountId;
    }
    const reportUser = (this.config.reportUserName || '').toLowerCase();
    return (author.emailAddress || '').toLowerCase() === reportUser ||
      author.name === this.config.reportUserName;
  }

  async searchTickets(jql) {
    // Atlassian removed /rest/api/2/search (CHANGE-2046); node-jira-client still
    // calls it, so hit the replacement /rest/api/3/search/jql directly.
    try {
      const issues = [];
      const auth = Buffer.from(`${this.config.username}:${this.config.apiToken}`).toString('base64');
      let nextPageToken;

      do {
        const response = await fetch(`${this.config.protocol}://${this.config.host}/rest/api/3/search/jql`, {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${auth}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            jql,
            fields: [
              'summary',
              'status',
              'priority',
              'assignee',
              'reporter',
              'created',
              'updated',
              'project',
              'issuetype',
              'description'
            ],
            maxResults: 100,
            ...(nextPageToken ? { nextPageToken } : {}),
          }),
        });

        if (!response.ok) {
          throw new Error(`${response.status} - ${await response.text()}`);
        }

        const data = await response.json();
        issues.push(...(data.issues || []));
        nextPageToken = data.isLast ? undefined : data.nextPageToken;
      } while (nextPageToken);

      return issues;
    } catch (error) {
      console.error('Error searching JIRA tickets:', error.message);
      return [];
    }
  }

  async getTicketChangelog(ticketKey, date) {
    try {
      const dateStr = format(date, 'yyyy-MM-dd');
      const nextDateStr = format(addDays(new Date(date), 1), 'yyyy-MM-dd');
      
      const ticket = await this.client.findIssue(ticketKey, {
        expand: ['changelog']
      });
      
      if (!ticket.changelog || !ticket.changelog.histories) {
        return [];
      }
      
      return ticket.changelog.histories.filter(history => {
        const historyDate = format(new Date(history.created), 'yyyy-MM-dd');
        return historyDate === dateStr;
      });
    } catch (error) {
      console.error(`Error getting changelog for ${ticketKey}:`, error.message);
      return [];
    }
  }

  async getTicketComments(ticketKey, date) {
    try {
      const dateStr = format(date, 'yyyy-MM-dd');
      
      const comments = await this.client.getComments(ticketKey);
      
      if (!comments.comments) {
        return [];
      }
      
      return comments.comments.filter(comment => {
        const commentDate = format(new Date(comment.created), 'yyyy-MM-dd');
        return commentDate === dateStr;
      });
    } catch (error) {
      console.error(`Error getting comments for ${ticketKey}:`, error.message);
      return [];
    }
  }
}

export default JiraIntegration;