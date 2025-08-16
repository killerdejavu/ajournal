import fs from 'fs-extra';
import { google } from 'googleapis';
import chalk from 'chalk';

export class TokenValidator {
  constructor() {
    this.tokenPath = './data/google-token.json';
  }

  async validateGoogleToken() {
    try {
      // Check if token file exists
      if (!await fs.pathExists(this.tokenPath)) {
        return {
          valid: false,
          error: 'Token file not found',
          needsRefresh: true
        };
      }

      // Load credentials
      const credentialsPath = process.env.GOOGLE_CREDENTIALS_PATH;
      if (!credentialsPath) {
        return {
          valid: false,
          error: 'GOOGLE_CREDENTIALS_PATH not set',
          needsRefresh: false
        };
      }

      const credentials = await fs.readJson(credentialsPath);
      const { client_secret, client_id, redirect_uris } = 
        credentials.installed || credentials.web || credentials;

      // Set up OAuth2 client
      const redirectUri = redirect_uris?.[0] || 'urn:ietf:wg:oauth:2.0:oob';
      const oAuth2Client = new google.auth.OAuth2(
        client_id,
        client_secret,
        redirectUri
      );

      // Load and set token
      const token = await fs.readJson(this.tokenPath);
      oAuth2Client.setCredentials(token);

      // Test the token by making a simple API call
      const calendar = google.calendar({ version: 'v3', auth: oAuth2Client });
      
      try {
        await calendar.calendarList.list({ maxResults: 1 });
        return {
          valid: true,
          error: null,
          needsRefresh: false
        };
      } catch (apiError) {
        // Check if it's an authentication error
        if (apiError.code === 401 || apiError.message.includes('invalid_grant') || 
            apiError.message.includes('Token has been expired')) {
          return {
            valid: false,
            error: 'Token expired or invalid',
            needsRefresh: true
          };
        }
        
        // Other API errors
        return {
          valid: false,
          error: `API Error: ${apiError.message}`,
          needsRefresh: false
        };
      }

    } catch (error) {
      return {
        valid: false,
        error: `Validation Error: ${error.message}`,
        needsRefresh: false
      };
    }
  }

  async promptTokenRefresh() {
    console.log(chalk.yellow('⚠️  Google Calendar token has expired or is invalid'));
    console.log(chalk.blue('🔄 Opening browser to refresh your token...'));
    
    try {
      // Load credentials
      const credentialsPath = process.env.GOOGLE_CREDENTIALS_PATH;
      const credentials = await fs.readJson(credentialsPath);
      const { client_secret, client_id, redirect_uris } = 
        credentials.installed || credentials.web || credentials;

      const redirectUri = redirect_uris?.[0] || 'urn:ietf:wg:oauth:2.0:oob';
      const oAuth2Client = new google.auth.OAuth2(
        client_id,
        client_secret,
        redirectUri
      );

      // Generate auth URL
      const authUrl = oAuth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: ['https://www.googleapis.com/auth/calendar.readonly'],
        prompt: 'consent'
      });

      console.log(chalk.cyan('\n📋 Authorization URL:'));
      console.log(authUrl);

      // Try to open browser
      try {
        const { default: open } = await import('open');
        await open(authUrl);
        console.log(chalk.green('✅ Browser opened automatically'));
      } catch (error) {
        console.log(chalk.yellow('⚠️  Could not open browser automatically'));
        console.log(chalk.yellow('Please copy the URL above and open it manually'));
      }

      console.log(chalk.blue('\n📝 After authorizing, you will receive an authorization code.'));
      console.log(chalk.yellow('Please copy that code and run:'));
      console.log(chalk.cyan('  node setup-google-oauth.js'));
      console.log();

      return false; // Indicates user needs to complete the flow
    } catch (error) {
      console.error(chalk.red('❌ Failed to generate refresh URL:'), error.message);
      return false;
    }
  }
}

export async function validateGCalTokenBeforeRun() {
  // Only validate if Google Calendar is enabled
  const config = await import('../config/config.js').then(m => m.default);
  await config.load();
  
  if (!config.get('integrations.gcal.enabled')) {
    return true; // Skip validation if GCal is disabled
  }

  const validator = new TokenValidator();
  const result = await validator.validateGoogleToken();
  
  if (!result.valid && result.needsRefresh) {
    console.log(chalk.red('❌ Google Calendar authentication failed'));
    console.log(chalk.yellow('Token needs to be refreshed before continuing...'));
    
    const success = await validator.promptTokenRefresh();
    if (!success) {
      console.log(chalk.red('⚠️  Please refresh your Google Calendar token and try again'));
      return false;
    }
  } else if (!result.valid) {
    console.log(chalk.red('❌ Google Calendar validation failed:'), result.error);
    return false;
  }
  
  console.log(chalk.green('✅ Google Calendar token is valid'));
  return true;
}