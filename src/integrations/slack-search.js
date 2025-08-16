import { WebClient } from '@slack/web-api';
import { format, startOfDay, endOfDay } from 'date-fns';

class SlackSearchIntegration {
  constructor(config, storage) {
    this.name = 'Slack';
    this.config = config.integrations.slack;
    this.storage = storage;
    this.client = new WebClient(process.env.SLACK_USER_TOKEN);
    this.userId = null;
    this.username = null;
  }

  async sync(startDate, endDate) {
    try {
      console.log('🔍 Using Slack search.messages API with day-by-day search');

      // Get authenticated user info first
      if (!this.userId) {
        const authResult = await this.client.auth.test();
        this.userId = authResult.user_id;
        this.username = authResult.user;
        console.log(`👤 Authenticated as user: ${this.userId} (@${this.username})`);
      }

      let allActivities = [];
      const allActivitiesByDate = {};
      
      // Search day by day to ensure we get all messages
      const currentDate = new Date(startDate);
      while (currentDate <= endDate) {
        const nextDate = new Date(currentDate);
        nextDate.setDate(nextDate.getDate() + 1);
        
        const dayStart = new Date(currentDate);
        const dayEnd = new Date(nextDate);
        
        console.log(`🔎 Searching messages for ${format(currentDate, 'yyyy-MM-dd')}`);
        
        // Search for user's messages in this specific day
        const messages = await this.searchUserMessages(dayStart, dayEnd);
        console.log(`📨 Found ${messages.length} messages for ${format(currentDate, 'yyyy-MM-dd')}`);

        // Process messages for this day
        const dayActivities = [];
        for (const msg of messages) {
          const processedMessage = this.processSearchMessage(msg);
          if (processedMessage && this.shouldIncludeMessage(processedMessage)) {
            dayActivities.push(processedMessage);
          }
        }

        if (dayActivities.length > 0) {
          const dateStr = format(currentDate, 'yyyy-MM-dd');
          allActivitiesByDate[dateStr] = dayActivities;
          allActivities.push(...dayActivities);
          console.log(`✅ ${dayActivities.length} activities for ${dateStr}`);
        }

        currentDate.setDate(currentDate.getDate() + 1);
        
        // Add a small delay to respect rate limits
        await new Promise(resolve => setTimeout(resolve, this.config.rateLimitDelay || 1200));
      }

      console.log(`📊 Total activities found: ${allActivities.length}`);

      // Save activities by date
      for (const [dateStr, dayActivities] of Object.entries(allActivitiesByDate)) {
        await this.storage.saveRawData('slack', dateStr, dayActivities);
        console.log(`💾 Saved ${dayActivities.length} activities for ${dateStr}`);
      }

      // Update sync state
      await this.storage.setSyncState('slack', {
        lastSyncStart: startDate.toISOString(),
        lastSyncEnd: endDate.toISOString(),
        totalActivities: allActivities.length,
        userId: this.userId,
        username: this.username,
        method: 'search_api_daily',
      });

      console.log(`✅ Slack search sync completed successfully!`);
      return allActivities;

    } catch (error) {
      console.error('❌ Slack search sync error:', error.message);
      throw error;
    }
  }

  async searchUserMessages(startDate, endDate) {
    try {
      // For single day search, use 'on:' which works better
      const dateStr = format(startDate, 'yyyy-MM-dd');
      const query = `from:${this.username} on:${dateStr}`;
      console.log(`🔎 Search query: "${query}"`);

      // Search API has max limit of 100 per page
      const count = Math.min(this.config.maxMessages || 100, 100);
      
      let allMessages = [];
      let page = 1;
      const maxPages = 5; // Limit to prevent excessive API calls
      
      // Paginate through search results
      while (page <= maxPages) {
        const result = await this.client.search.messages({
          query: query,
          sort: 'timestamp',
          sort_dir: 'desc',
          count: count,
          page: page
        });
        
        if (!result.messages.matches || result.messages.matches.length === 0) {
          break;
        }
        
        allMessages.push(...result.messages.matches);
        
        // Log pagination info
        if (page === 1) {
          console.log(`📊 Search results: ${result.messages.total} total matches`);
        }
        console.log(`📄 Page ${page}: ${result.messages.matches.length} messages`);
        
        // Break if we got fewer results than requested (last page)
        if (result.messages.matches.length < count) {
          break;
        }
        
        page++;
        
        // Add delay between pages to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 1200));
      }

      console.log(`📨 Total messages collected: ${allMessages.length}`);
      
      // Now get thread replies for messages that have them
      const messagesWithThreads = await this.getThreadReplies(allMessages, dateStr);
      
      console.log(`🧵 Total messages including threads: ${messagesWithThreads.length}`);

      return messagesWithThreads;
    } catch (error) {
      console.error('❌ Error searching messages:', error.message);
      if (error.data) {
        console.error('Error details:', error.data);
      }
      return [];
    }
  }

  processSearchMessage(msg) {
    try {
      const timestamp = new Date(parseFloat(msg.ts) * 1000).toISOString();
      
      // Determine channel info and type
      const channelInfo = this.getChannelInfo(msg.channel);
      
      return {
        type: channelInfo.type,
        channel: channelInfo.name,
        channelId: msg.channel.id,
        timestamp: timestamp,
        text: msg.text || '',
        user: msg.user,
        isUserMessage: true, // Search only returns user's messages
        threadTs: msg.thread_ts,
        permalink: msg.permalink,
        reactions: [], // Search API doesn't include reactions
        intent: this.extractIntent(msg.text || '', channelInfo.name),
        searchScore: msg.score || 0,
      };
    } catch (error) {
      console.error('❌ Error processing message:', error.message);
      return null;
    }
  }

  getChannelInfo(channel) {
    if (channel.is_im) {
      return { type: 'direct_message', name: 'Direct Message' };
    } else if (channel.is_mpim) {
      return { type: 'group_message', name: 'Group DM' };
    } else if (channel.is_private) {
      return { type: 'private_channel_message', name: channel.name };
    } else if (channel.is_channel) {
      return { type: 'public_channel_message', name: channel.name };
    } else {
      return { type: 'unknown_message', name: channel.id };
    }
  }

  shouldIncludeMessage(message) {
    // Apply same filtering as before
    if (message.text.length < this.config.minMessageLength) {
      return false;
    }

    // Skip excluded channels
    if (this.config.excludeChannels.includes(message.channel)) {
      return false;
    }

    // Skip channels matching excluded patterns
    if (this.config.excludeChannelPatterns.some(pattern => {
      const regex = new RegExp(pattern.replace('*', '.*'), 'i');
      return regex.test(message.channel);
    })) {
      return false;
    }

    // Skip DMs if not tracking them
    if (!this.config.trackDMs && message.type === 'direct_message') {
      return false;
    }

    return true;
  }

  extractIntent(text, channelName) {
    // Same intent extraction logic as before
    const intents = [];

    if (text.includes('?') || text.toLowerCase().startsWith('how ') || 
        text.toLowerCase().startsWith('what ') || text.toLowerCase().startsWith('why ')) {
      intents.push('question');
    }

    if (text.toLowerCase().includes('decision') || text.toLowerCase().includes('decide') ||
        text.toLowerCase().includes('should we')) {
      intents.push('decision');
    }

    if (text.toLowerCase().includes('update') || text.toLowerCase().includes('progress') ||
        text.toLowerCase().includes('done') || text.toLowerCase().includes('completed')) {
      intents.push('status_update');
    }

    if (text.toLowerCase().includes('meeting') || text.toLowerCase().includes('schedule') ||
        text.toLowerCase().includes('sync') || text.toLowerCase().includes('coordinate')) {
      intents.push('coordination');
    }

    if (text.toLowerCase().includes('issue') || text.toLowerCase().includes('problem') ||
        text.toLowerCase().includes('bug') || text.toLowerCase().includes('error')) {
      intents.push('problem_solving');
    }

    if (text.toLowerCase().includes('fyi') || text.toLowerCase().includes('heads up') ||
        text.toLowerCase().includes('announcement')) {
      intents.push('information_sharing');
    }

    return intents.length > 0 ? intents : ['general_communication'];
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

  async getThreadReplies(messages, dateStr) {
    const allMessages = [...messages];
    const processedThreads = new Set();

    for (const message of messages) {
      // Skip if this message is already a reply or we've processed this thread
      if (message.thread_ts && message.thread_ts !== message.ts) {
        continue;
      }

      // Skip if no thread exists or we've already processed it
      if (!message.thread_ts || processedThreads.has(message.thread_ts)) {
        continue;
      }

      try {
        console.log(`🧵 Fetching thread replies for message in ${message.channel?.name}...`);
        
        const replies = await this.client.conversations.replies({
          channel: message.channel.id,
          ts: message.thread_ts,
          limit: 100
        });

        if (replies.messages && replies.messages.length > 1) {
          // Filter replies to only those from our user and on the target date
          const userReplies = replies.messages
            .filter(reply => 
              reply.user === this.userId && 
              reply.ts !== message.ts && // Exclude the original message
              this.isMessageOnDate(reply.ts, dateStr)
            )
            .map(reply => this.convertReplyToSearchFormat(reply, message.channel));

          allMessages.push(...userReplies);
          console.log(`  📝 Found ${userReplies.length} user replies in thread`);
        }

        processedThreads.add(message.thread_ts);
        
        // Add delay to respect rate limits
        await new Promise(resolve => setTimeout(resolve, 500));

      } catch (error) {
        console.error(`❌ Error fetching thread replies: ${error.message}`);
      }
    }

    return allMessages;
  }

  isMessageOnDate(ts, targetDateStr) {
    const messageDate = new Date(parseFloat(ts) * 1000);
    const messageDateStr = format(messageDate, 'yyyy-MM-dd');
    return messageDateStr === targetDateStr;
  }

  convertReplyToSearchFormat(reply, channel) {
    return {
      type: 'message',
      channel: channel,
      user: reply.user,
      username: this.username,
      ts: reply.ts,
      thread_ts: reply.thread_ts,
      text: reply.text || '',
      permalink: `https://${process.env.SLACK_WORKSPACE || 'yourworkspace'}.slack.com/archives/${channel.id}/p${reply.ts.replace('.', '')}?thread_ts=${reply.thread_ts}`,
      team: reply.team,
      blocks: reply.blocks || [],
      reactions: reply.reactions || []
    };
  }
}

export default SlackSearchIntegration;