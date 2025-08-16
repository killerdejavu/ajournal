import { google } from 'googleapis';
import fs from 'fs-extra';
import { format, startOfDay, endOfDay } from 'date-fns';

class GCalIntegration {
  constructor(config, storage) {
    this.name = 'Google Calendar';
    this.config = config.integrations.gcal;
    this.storage = storage;
    this.calendar = null;
  }

  async init() {
    try {
      // Load credentials from file
      const credentialsPath = process.env.GOOGLE_CREDENTIALS_PATH;
      if (!credentialsPath) {
        throw new Error('GOOGLE_CREDENTIALS_PATH environment variable not set');
      }

      const credentials = await fs.readJson(credentialsPath);
      
      // For service account credentials (recommended)
      if (credentials.type === 'service_account') {
        const auth = new google.auth.GoogleAuth({
          keyFile: credentialsPath,
          scopes: ['https://www.googleapis.com/auth/calendar.readonly'],
        });
        
        this.calendar = google.calendar({ version: 'v3', auth });
      } else {
        // For OAuth2 credentials (legacy support)
        const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web || credentials;
        
        const oAuth2Client = new google.auth.OAuth2(
          client_id,
          client_secret,
          redirect_uris[0]
        );

        const tokenPath = './data/google-token.json';
        
        if (await fs.pathExists(tokenPath)) {
          const token = await fs.readJson(tokenPath);
          oAuth2Client.setCredentials(token);
        } else {
          throw new Error(`Google OAuth token not found at ${tokenPath}. Please run: node setup-google-oauth.js`);
        }
        
        this.calendar = google.calendar({ version: 'v3', auth: oAuth2Client });
      }
    } catch (error) {
      console.error('Error initializing Google Calendar:', error.message);
      throw error;
    }
  }

  async sync(startDate, endDate) {
    try {
      if (!this.calendar) {
        await this.init();
      }

      const activities = [];

      // Get calendar list
      const calendars = await this.getCalendars();
      const filteredCalendars = this.filterCalendars(calendars);

      // Get events from each calendar
      for (const calendar of filteredCalendars) {
        try {
          const events = await this.getCalendarEvents(calendar, startDate, endDate);
          activities.push(...events);
        } catch (error) {
          console.error(`Error fetching events from ${calendar.summary}:`, error.message);
        }
      }

      // Group activities by date and save
      const activitiesByDate = this.groupActivitiesByDate(activities);
      
      for (const [dateStr, dayActivities] of Object.entries(activitiesByDate)) {
        await this.storage.saveRawData('gcal', dateStr, dayActivities);
      }

      // Update sync state
      await this.storage.setSyncState('gcal', {
        lastSyncStart: startDate.toISOString(),
        lastSyncEnd: endDate.toISOString(),
        totalActivities: activities.length,
      });

      return activities;
    } catch (error) {
      console.error('Google Calendar sync error:', error.message);
      throw error;
    }
  }

  async getCalendars() {
    try {
      const response = await this.calendar.calendarList.list();
      return response.data.items || [];
    } catch (error) {
      console.error('Error fetching calendar list:', error.message);
      return [];
    }
  }

  filterCalendars(calendars) {
    return calendars.filter(calendar => {
      const calendarName = calendar.summary.toLowerCase();
      const calendarId = calendar.id.toLowerCase();
      
      // If includeCalendars is specified, only include those calendars
      if (this.config.includeCalendars && this.config.includeCalendars.length > 0) {
        const shouldInclude = this.config.includeCalendars.some(included => {
          const includedLower = included.toLowerCase();
          return calendarName.includes(includedLower) || 
                 calendarId.includes(includedLower) ||
                 calendar.id === included || 
                 calendar.summary === included;
        });
        
        if (!shouldInclude) {
          return false;
        }
      }
      
      // Skip excluded calendars
      if (this.config.excludeCalendars.some(excluded => 
        calendarName.includes(excluded.toLowerCase()) ||
        calendarId.includes(excluded.toLowerCase())
      )) {
        return false;
      }

      // Skip calendars matching excluded patterns
      if (this.config.excludeCalendarPatterns.some(pattern => {
        const regex = new RegExp(pattern.replace('*', '.*'), 'i');
        return regex.test(calendarName) || regex.test(calendarId);
      })) {
        return false;
      }

      return true;
    });
  }

  async getCalendarEvents(calendar, startDate, endDate) {
    try {
      const response = await this.calendar.events.list({
        calendarId: calendar.id,
        timeMin: startDate.toISOString(),
        timeMax: endDate.toISOString(),
        singleEvents: true,
        orderBy: 'startTime',
        maxResults: 2500,
      });

      const events = response.data.items || [];
      
      return events
        .filter(event => this.shouldIncludeEvent(event))
        .map(event => this.processEvent(event, calendar));
    } catch (error) {
      console.error(`Error fetching events from ${calendar.summary}:`, error.message);
      return [];
    }
  }

  shouldIncludeEvent(event) {
    // Skip events without start time
    if (!event.start || (!event.start.dateTime && !event.start.date)) {
      return false;
    }

    // Skip all-day events if they're not work-related
    if (event.start.date && !event.start.dateTime) {
      return false;
    }

    // Skip excluded event titles
    const eventTitle = (event.summary || '').toLowerCase();
    if (this.config.excludeEvents && this.config.excludeEvents.some(excluded => 
      eventTitle === excluded.toLowerCase()
    )) {
      return false;
    }

    // Skip events matching excluded patterns
    if (this.config.excludeEventPatterns && this.config.excludeEventPatterns.some(pattern => {
      const regex = new RegExp(pattern.replace(/\*/g, '.*'), 'i');
      return regex.test(eventTitle);
    })) {
      return false;
    }

    // Calculate duration
    const start = new Date(event.start.dateTime || event.start.date);
    const end = new Date(event.end.dateTime || event.end.date);
    const durationMinutes = (end - start) / (1000 * 60);

    // Skip short events
    if (durationMinutes < this.config.minDuration) {
      return false;
    }

    // Skip declined events
    if (event.attendees && event.attendees.some(attendee => 
      attendee.self && attendee.responseStatus === 'declined'
    )) {
      return false;
    }

    return true;
  }

  processEvent(event, calendar) {
    const start = new Date(event.start.dateTime || event.start.date);
    const end = new Date(event.end.dateTime || event.end.date);
    const durationMinutes = (end - start) / (1000 * 60);

    const processed = {
      type: 'calendar_event',
      calendar: calendar.summary,
      calendarId: calendar.id,
      title: event.summary || 'Untitled Event',
      description: event.description || '',
      start: start.toISOString(),
      end: end.toISOString(),
      timestamp: start.toISOString(),
      duration: durationMinutes,
      location: event.location || '',
      eventType: this.categorizeEvent(event),
      attendeeCount: 0,
      isOrganizer: false,
      meetingLink: this.extractMeetingLink(event),
    };

    // Process attendees if tracking is enabled
    if (this.config.trackAttendees && event.attendees) {
      processed.attendeeCount = event.attendees.length;
      processed.isOrganizer = event.attendees.some(attendee => attendee.organizer && attendee.self);
      
      if (this.config.trackLocation) {
        processed.attendees = event.attendees
          .filter(attendee => attendee.responseStatus !== 'declined')
          .map(attendee => ({
            email: attendee.email,
            responseStatus: attendee.responseStatus,
            organizer: attendee.organizer || false,
          }));
      }
    }

    return processed;
  }

  categorizeEvent(event) {
    const title = (event.summary || '').toLowerCase();
    const description = (event.description || '').toLowerCase();
    const combined = `${title} ${description}`;

    // Meeting categories
    if (combined.includes('standup') || combined.includes('stand up') || combined.includes('daily')) {
      return 'standup';
    }
    
    if (combined.includes('retro') || combined.includes('retrospective')) {
      return 'retrospective';
    }
    
    if (combined.includes('planning') || combined.includes('sprint planning')) {
      return 'planning';
    }
    
    if (combined.includes('review') || combined.includes('demo')) {
      return 'review';
    }
    
    if (combined.includes('1:1') || combined.includes('one on one') || combined.includes('1-on-1')) {
      return 'one_on_one';
    }
    
    if (combined.includes('interview') || combined.includes('screening')) {
      return 'interview';
    }
    
    if (combined.includes('all hands') || combined.includes('town hall') || combined.includes('company')) {
      return 'all_hands';
    }
    
    if (combined.includes('training') || combined.includes('workshop') || combined.includes('learning')) {
      return 'training';
    }

    // Default to meeting
    if (event.attendees && event.attendees.length > 1) {
      return 'meeting';
    }
    
    return 'focus_time';
  }

  extractMeetingLink(event) {
    const description = event.description || '';
    const location = event.location || '';
    
    // Common meeting link patterns
    const patterns = [
      /https:\/\/meet\.google\.com\/[a-z-]+/i,
      /https:\/\/zoom\.us\/j\/\d+/i,
      /https:\/\/.*\.zoom\.us\/j\/\d+/i,
      /https:\/\/teams\.microsoft\.com\/l\/meetup-join\/[^\\s]+/i,
    ];
    
    const content = `${description} ${location}`;
    
    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match) {
        return match[0];
      }
    }
    
    return null;
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

  // Helper method to generate OAuth URL for initial setup
  static generateAuthUrl(credentialsPath) {
    const credentials = require(credentialsPath);
    const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
    
    const oAuth2Client = new google.auth.OAuth2(
      client_id,
      client_secret,
      redirect_uris[0]
    );

    const authUrl = oAuth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: ['https://www.googleapis.com/auth/calendar.readonly'],
    });

    return { authUrl, oAuth2Client };
  }
}

export default GCalIntegration;