import Anthropic from '@anthropic-ai/sdk';

class AIService {
  constructor(config) {
    this.config = config.ai;
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }

  async summarizeActivities(activities, date) {
    try {
      const prompt = this.buildSummarizationPrompt(activities, date);
      
      const response = await this.client.messages.create({
        model: this.config.model,
        max_tokens: this.config.maxTokens,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      });

      return response.content[0].text;
    } catch (error) {
      console.error('AI summarization error:', error.message);
      return this.fallbackSummary(activities, date);
    }
  }

  buildSummarizationPrompt(activities, date) {
    const dateStr = date.toDateString();
    
    // Group activities by source
    const slackActivities = activities.filter(a => a.source === 'slack');
    const githubActivities = activities.filter(a => a.source === 'github');
    const calendarActivities = activities.filter(a => a.source === 'gcal');

    let activitiesText = `Work activities for ${dateStr}:\n\n`;

    // Add Slack activities
    if (slackActivities.length > 0) {
      activitiesText += `**Slack Communications (${slackActivities.length} activities):**\n`;
      slackActivities.forEach(activity => {
        const data = activity.data;
        activitiesText += `- ${data.type} in #${data.channel}: "${data.text.substring(0, 100)}..." (Intent: ${data.intent.join(', ')})\n`;
      });
      activitiesText += '\n';
    }

    // Add GitHub activities
    if (githubActivities.length > 0) {
      activitiesText += `**GitHub Activities (${githubActivities.length} activities):**\n`;
      githubActivities.forEach(activity => {
        const data = activity.data;
        if (data.type === 'pr_created') {
          activitiesText += `- Created PR: "${data.title}" in ${data.repository}\n`;
        } else if (data.type === 'pr_reviewed') {
          activitiesText += `- Reviewed PR: "${data.title}" in ${data.repository} (${data.reviewState})\n`;
        } else if (data.type === 'commit') {
          activitiesText += `- Committed: "${data.message}" in ${data.repository}\n`;
        } else if (data.type === 'issue_activity') {
          activitiesText += `- Issue activity: "${data.title}" in ${data.repository}\n`;
        }
      });
      activitiesText += '\n';
    }

    // Add Calendar activities
    if (calendarActivities.length > 0) {
      activitiesText += `**Calendar Events (${calendarActivities.length} events):**\n`;
      calendarActivities.forEach(activity => {
        const data = activity.data;
        const duration = Math.round(data.duration / 60 * 100) / 100;
        activitiesText += `- ${data.eventType}: "${data.title}" (${duration}h, ${data.attendeeCount} attendees)\n`;
      });
      activitiesText += '\n';
    }

    const fullPrompt = `${this.config.summarizationPrompt}

${activitiesText}

Please create a professional work journal summary for this day. Focus on productivity insights, key accomplishments, and time allocation patterns.`;

    return fullPrompt;
  }

  async categorizeActivities(activities) {
    if (!this.config.categorizeWork) {
      return activities;
    }

    try {
      const prompt = `Please categorize the following work activities into logical groups and identify patterns:

${activities.map((activity, index) => 
  `${index}. ${this.describeActivity(activity)}`
).join('\n')}

Return ONLY a JSON object with categories as keys and arrays of activity indices (0-indexed) as values. Use categories like: "Development", "Meetings", "Communication", "Code Review", "Planning", etc.

Example format:
{
  "Development": [0, 2, 5],
  "Meetings": [1, 3],
  "Communication": [4, 6]
}`;

      const response = await this.client.messages.create({
        model: this.config.model,
        max_tokens: 1000,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      });

      // Extract JSON from the response text
      const responseText = response.content[0].text;
      let jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('No JSON found in response');
      }
      
      const categorization = JSON.parse(jsonMatch[0]);
      
      // Apply categorization to activities
      const categorizedActivities = { ...categorization };
      for (const [category, indices] of Object.entries(categorization)) {
        categorizedActivities[category] = indices.map(index => activities[index]);
      }

      return categorizedActivities;
    } catch (error) {
      console.error('AI categorization error:', error.message);
      return this.fallbackCategorization(activities);
    }
  }

  async generateInsights(activities, date) {
    if (!this.config.includeMetrics) {
      return null;
    }

    try {
      const metrics = this.calculateMetrics(activities);
      
      const prompt = `Based on the following work metrics for ${date.toDateString()}, provide 2-3 brief insights about productivity patterns:

**Time Distribution:**
- Meetings: ${metrics.meetingTime} hours
- Development: ${metrics.developmentTime} hours  
- Communication: ${metrics.communicationTime} hours

**Activity Counts:**
- GitHub activities: ${metrics.githubCount}
- Slack messages: ${metrics.slackCount}
- Calendar events: ${metrics.calendarCount}

**Key Patterns:**
${metrics.patterns.join('\n')}

Provide actionable insights in 2-3 bullet points.`;

      const response = await this.client.messages.create({
        model: this.config.model,
        max_tokens: 300,
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ]
      });

      return response.content[0].text;
    } catch (error) {
      console.error('AI insights error:', error.message);
      return null;
    }
  }

  calculateMetrics(activities) {
    const metrics = {
      meetingTime: 0,
      developmentTime: 0,
      communicationTime: 0,
      githubCount: 0,
      slackCount: 0,
      calendarCount: 0,
      patterns: [],
    };

    activities.forEach(activity => {
      switch (activity.source) {
        case 'slack':
          metrics.slackCount++;
          metrics.communicationTime += 0.1; // Estimate 6 minutes per message
          break;
        case 'github':
          metrics.githubCount++;
          metrics.developmentTime += 0.5; // Estimate 30 minutes per activity
          break;
        case 'gcal':
          metrics.calendarCount++;
          metrics.meetingTime += activity.data.duration / 60; // Convert to hours
          break;
      }
    });

    // Generate patterns
    if (metrics.meetingTime > 4) {
      metrics.patterns.push('High meeting day (4+ hours)');
    }
    
    if (metrics.githubCount > 5) {
      metrics.patterns.push('High development activity');
    }
    
    if (metrics.slackCount > 20) {
      metrics.patterns.push('High communication volume');
    }

    return metrics;
  }

  describeActivity(activity) {
    const data = activity.data;
    
    switch (activity.source) {
      case 'slack':
        return `Slack ${data.type} in #${data.channel}: "${data.text.substring(0, 50)}..."`;
      case 'github':
        if (data.type === 'pr_created') {
          return `GitHub PR created: "${data.title}" in ${data.repository}`;
        } else if (data.type === 'pr_reviewed') {
          return `GitHub PR reviewed: "${data.title}" in ${data.repository}`;
        } else if (data.type === 'commit') {
          return `GitHub commit: "${data.message}" in ${data.repository}`;
        }
        return `GitHub ${data.type} in ${data.repository}`;
      case 'gcal':
        return `Calendar: ${data.eventType} "${data.title}" (${Math.round(data.duration)}min)`;
      default:
        return `${activity.source} activity`;
    }
  }

  fallbackSummary(activities, date) {
    const dateStr = date.toDateString();
    let summary = `# Work Summary for ${dateStr}\n\n`;
    
    const slackCount = activities.filter(a => a.source === 'slack').length;
    const githubCount = activities.filter(a => a.source === 'github').length;
    const calendarCount = activities.filter(a => a.source === 'gcal').length;
    
    summary += `## Activity Overview\n`;
    summary += `- **Slack Communications**: ${slackCount} activities\n`;
    summary += `- **GitHub Activities**: ${githubCount} activities\n`;
    summary += `- **Calendar Events**: ${calendarCount} events\n\n`;
    
    summary += `## Key Activities\n`;
    activities.slice(0, 10).forEach(activity => {
      summary += `- ${this.describeActivity(activity)}\n`;
    });
    
    return summary;
  }

  fallbackCategorization(activities) {
    const categories = {
      'Communication': activities.filter(a => a.source === 'slack'),
      'Development': activities.filter(a => a.source === 'github'),
      'Meetings': activities.filter(a => a.source === 'gcal'),
    };

    // Remove empty categories
    Object.keys(categories).forEach(key => {
      if (categories[key].length === 0) {
        delete categories[key];
      }
    });

    return categories;
  }
}

export default AIService;